# Claude Code Prompt — Auth Fix + Meal/Med Time Windows + SSRI Luteal Reminder

Three self-contained fixes. Do them in order. Do not change anything outside the scope of each fix.

---

## Fix 1 — Google OAuth token refresh (PRIORITY — do this first)

### The problem
The access token expires after exactly 1 hour and the app is falling back to a login prompt instead of silently refreshing. This is caused by one or more of the following in `driveSync.ts` or the auth initialisation:
- The initial OAuth request is missing `access_type: 'offline'` so Google never issues a refresh token
- The refresh token is not being persisted to localStorage
- Silent refresh is only attempted on app load, not proactively during a live session

### What to fix

**Step 1 — Fix the initial auth request**

Find where the Google OAuth popup or redirect is initiated. Ensure the following parameters are present:

```typescript
const authParams = {
  client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  redirect_uri: window.location.origin,
  response_type: 'code',       // must be 'code' not 'token' to get refresh token
  scope: 'https://www.googleapis.com/auth/drive.appdata',
  access_type: 'offline',      // REQUIRED — tells Google to issue a refresh token
  prompt: 'consent',           // REQUIRED on first auth — forces refresh token issuance
};
```

If the app is currently using `response_type: 'token'` (implicit flow), migrate it to `response_type: 'code'` (authorisation code flow). The code flow is the only way to get a refresh token.

**Step 2 — Store both tokens in localStorage**

After the initial auth exchange, store:

```typescript
localStorage.setItem('lifehex_access_token', accessToken);
localStorage.setItem('lifehex_refresh_token', refreshToken);  // add this if missing
localStorage.setItem('lifehex_token_expiry', String(Date.now() + 3600 * 1000)); // 1 hour from now
localStorage.setItem('lifehexConnected', 'true');
```

**Step 3 — Add a proactive token refresh timer**

In `driveSync.ts` or a new `tokenManager.ts`, add a function that runs on a 10-minute interval and refreshes the access token if it expires within the next 5 minutes:

```typescript
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // check every 10 minutes

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('lifehex_refresh_token');
  if (!refreshToken) return null;

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET, // see note below
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      // Refresh token itself has expired or been revoked — need full re-login
      localStorage.removeItem('lifehex_access_token');
      localStorage.removeItem('lifehex_refresh_token');
      localStorage.removeItem('lifehex_token_expiry');
      localStorage.setItem('lifehexConnected', 'false');
      return null;
    }

    const data = await response.json();
    localStorage.setItem('lifehex_access_token', data.access_token);
    localStorage.setItem('lifehex_token_expiry', String(Date.now() + data.expires_in * 1000));
    return data.access_token;
  } catch {
    return null;
  }
}

function startTokenRefreshTimer() {
  setInterval(async () => {
    const expiry = Number(localStorage.getItem('lifehex_token_expiry') ?? '0');
    const connected = localStorage.getItem('lifehexConnected') === 'true';
    if (!connected) return;
    if (expiry - Date.now() < REFRESH_MARGIN_MS) {
      await refreshAccessToken();
    }
  }, CHECK_INTERVAL_MS);
}
```

Call `startTokenRefreshTimer()` once when the app mounts (in `App.tsx` or `main.tsx`) — not inside a component that re-renders.

Also call `refreshAccessToken()` at the start of the sync-on-load flow as a first step, before fetching the Drive file:

```typescript
// In syncOnLoad():
const token = await getValidToken(); // gets stored token or refreshes if needed
if (!token) {
  // silent refresh failed — show reconnect banner, don't prompt a popup
  setDriveStatus('disconnected');
  return;
}
```

```typescript
async function getValidToken(): Promise<string | null> {
  const expiry = Number(localStorage.getItem('lifehex_token_expiry') ?? '0');
  const token = localStorage.getItem('lifehex_access_token');
  if (token && Date.now() < expiry - REFRESH_MARGIN_MS) {
    return token; // still valid
  }
  return await refreshAccessToken(); // expired or close — refresh silently
}
```

> ⚠️ **Important — client secret:** The token refresh endpoint requires the OAuth client secret. Add `VITE_GOOGLE_CLIENT_SECRET` to the `.env` file and `.env.example`. This is safe to use in a personal browser app where you control the deployment, but note it will be visible in the built JS bundle. For a personal single-user app on GitHub Pages this is an acceptable tradeoff. Add a comment in the code noting this.

**Step 4 — On silent refresh failure, show a non-intrusive reconnect banner**

If `getValidToken()` returns null (refresh token expired or revoked), do NOT show a popup. Instead show a small banner at the top of the app:

```
┌─────────────────────────────────────────────────────┐
│  Drive sync disconnected — session expired          │
│  [ Reconnect ]                                      │
└─────────────────────────────────────────────────────┘
```

Banner styling: Deep Indigo bg `#16213e`, `border: 2px solid #c9a84c`, Butter Yellow text. Nunito 13px. Reconnect button triggers the full OAuth popup flow. The app continues to work normally in local-only mode until reconnected.

---

## Fix 2 — Meal and medication time-window logging

### The problem
Logging a meal or medication records the exact time the button was tapped, which becomes useless data when you're backfilling (e.g. checking breakfast at 9pm). The fix: if the tap happens within a defined time window, log the exact time. If outside the window, silently log a sensible default instead.

### Time windows and defaults

| Item | Window start | Window end | Default time if outside window |
|---|---|---|---|
| Breakfast | 6:00am | 11:00am | 09:30 |
| Morning meds (Dex) | 6:00am | 11:00am | 09:15 |
| Lunch | 11:00am | 3:00pm | 12:30 |
| Arvo meds (Dex) | 11:00am | 3:00pm | 13:00 |
| Dinner | 5:00pm | 9:00pm | 18:30 |
| SSRI | — | — | Never log a time (always null) |

### Implementation

Add a utility function in `src/utils/checklistTime.ts`:

```typescript
interface TimeWindow {
  startHour: number;  // 24h
  endHour: number;    // 24h
  defaultTime: string | null; // "HH:MM" or null for no time
}

const TIME_WINDOWS: Record<string, TimeWindow> = {
  breakfast:    { startHour: 6,  endHour: 11, defaultTime: '09:30' },
  morningMeds:  { startHour: 6,  endHour: 11, defaultTime: '09:15' },
  lunch:        { startHour: 11, endHour: 15, defaultTime: '12:30' },
  arvoMeds:     { startHour: 11, endHour: 15, defaultTime: '13:00' },
  dinner:       { startHour: 17, endHour: 21, defaultTime: '18:30' },
  ssri:         { startHour: 0,  endHour: 24, defaultTime: null },   // never log time
};

export function resolveChecklistTime(itemKey: string): string | null {
  const window = TIME_WINDOWS[itemKey];
  if (!window) return new Date().toTimeString().slice(0, 5); // unknown item — log exact time

  // SSRI and any item with null defaultTime — never log a time
  if (window.defaultTime === null) return null;

  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  if (currentHour >= window.startHour && currentHour < window.endHour) {
    // Within window — log exact time
    return now.toTimeString().slice(0, 5); // "HH:MM"
  } else {
    // Outside window — use silent default
    return window.defaultTime;
  }
}
```

Replace every instance in the codebase where a checklist item logs `new Date().toISOString()` or `new Date().toTimeString()` as its time with a call to `resolveChecklistTime(itemKey)`.

The `DayRecord` data model already stores times as `string | null` so no schema changes are needed.

**Do not show the user any indication that a default time was used** — it is silent. The timestamp displayed in the checklist row shows whatever time was resolved, whether exact or default.

---

## Fix 3 — SSRI luteal window reminder

### What to build

The SSRI checkbox should only appear in the Daily Checklist during the **14 days before the predicted period start date** (the pre-luteal and luteal window). Outside this window it is completely hidden — no greyed out state, just absent.

When it appears, it shows as a distinct checklist item with a visual treatment that signals it's cycle-linked rather than a daily routine item.

### Logic

In the checklist rendering logic, calculate whether today is within the SSRI window:

```typescript
function isSSRIWindow(cycles: CycleEntry[], settings: Settings): boolean {
  if (cycles.length === 0) return false;

  const nextPeriodStart = predictNextPeriodStart(cycles, settings); // use existing cyclePredictor.ts
  if (!nextPeriodStart) return false;

  const today = new Date();
  const daysUntilPeriod = differenceInDays(nextPeriodStart, today);

  // Show SSRI reminder for the 14 days leading up to period start
  // Also show during the period itself (days 0 to -periodLength)
  return daysUntilPeriod >= 0 && daysUntilPeriod <= 14;
}
```

Use `date-fns` `differenceInDays` (already installed).

### Checklist item rendering

When `isSSRIWindow` is true, render the SSRI row in the Daily Checklist **above the meal rows**, directly below the Dex medication rows. It should be visually distinct from the regular checklist items:

```
┌─────────────────────────────────────────────────────┐
│  🌙  SSRI                          ✓ logged / [ ]   │
│  Luteal window — 6 days to period                   │
└─────────────────────────────────────────────────────┘
```

Styling:
- Background: `rgba(247, 202, 201, 0.12)` (very faint Blush Pink)
- Border: `2px solid #c98a88` (Blush Shadow)
- `box-shadow: 3px 3px 0px #c98a88`
- Label: Press Start 2P 10px Cloud White — "SSRI"
- Sub-label: Nunito 12px Muted Purple — "Luteal window · {N} days to period" (or "Period in progress" if daysUntilPeriod < 0)
- Moon emoji 🌙 prefix on the label
- Checkbox behaviour: same as other items — tap to check, logs today's date only (no time, matching the `resolveChecklistTime('ssri')` → `null` rule from Fix 2)

When `isSSRIWindow` is false, the SSRI row is completely absent from the DOM — `{isSSRIWindow && <SSRIRow />}`. No placeholder, no hidden element.

### DayRecord schema addition

Add `ssriTaken: boolean` to the `DayRecord` interface:

```typescript
// In types/index.ts, inside DayRecord:
ssriTaken: boolean;   // default: false. Only meaningful during luteal window but stored regardless.
```

Initialise it as `false` in the default `DayRecord` factory function. Store and sync it the same way as other boolean checklist fields — no other model changes needed.

---

## Summary of files to change

| File | Change |
|---|---|
| `src/utils/driveSync.ts` | Add `getValidToken()`, update sync-on-load to call it first |
| `src/utils/tokenManager.ts` | New file — `startTokenRefreshTimer()`, `refreshAccessToken()` |
| `src/main.tsx` or `App.tsx` | Call `startTokenRefreshTimer()` once on mount |
| `.env` + `.env.example` | Add `VITE_GOOGLE_CLIENT_SECRET` |
| `src/utils/checklistTime.ts` | New file — `resolveChecklistTime()` |
| `src/components/DailyChecklist.tsx` | Use `resolveChecklistTime()` for all time logging, add SSRI row with `isSSRIWindow` guard |
| `src/utils/cyclePredictor.ts` | Export `predictNextPeriodStart()` if not already exported |
| `src/types/index.ts` | Add `ssriTaken: boolean` to `DayRecord` |

## What NOT to change

- The Drive sync merge logic (`_merge`, `isDriveFileEmpty`) — already correct from the last fix
- The session lock/unlock logic
- The radar chart or dimension scores
- The mood/energy/regulation sliders
- Any chart or dashboard components
- The mobile `/mobile` route — Fix 2 and Fix 3 apply there too since it uses the same stores and components, but do not restructure the mobile layout
