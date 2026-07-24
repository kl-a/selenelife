import { useDriveStore } from '../store/driveStore';

// Personal single-user app — client secret is intentionally in the bundle.
// Acceptable tradeoff for a GitHub Pages deploy with no backend.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string;
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// Includes the /selenelife/ base path so GitHub Pages serves the app on redirect.
// In dev this resolves to http://localhost:5173 (BASE_URL is '/').
const REDIRECT_URI = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64urlEncode(verifierBytes.buffer);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(digest);
  return { verifier, challenge };
}

// ─── token refresh ────────────────────────────────────────────────────────────

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('lifehex_refresh_token');
  if (!refreshToken) return null;

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      localStorage.removeItem('lifehex_access_token');
      localStorage.removeItem('lifehex_refresh_token');
      localStorage.removeItem('lifehex_token_expiry');
      useDriveStore.getState().setNeedsReconnect(true);
      return null;
    }

    const data = await response.json();
    const accessToken = data.access_token as string;
    const expiresIn = data.expires_in as number;
    localStorage.setItem('lifehex_access_token', accessToken);
    localStorage.setItem('lifehex_token_expiry', String(Date.now() + expiresIn * 1000));
    useDriveStore.getState().setToken(accessToken, expiresIn);
    useDriveStore.getState().setNeedsReconnect(false);
    return accessToken;
  } catch {
    return null;
  }
}

export async function getValidToken(): Promise<string | null> {
  const { accessToken, tokenExpiry } = useDriveStore.getState();
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry - REFRESH_MARGIN_MS) {
    return accessToken;
  }
  return refreshAccessToken();
}

export function startTokenRefreshTimer(): void {
  setInterval(async () => {
    const { connected } = useDriveStore.getState();
    if (!connected) return;
    const expiry = Number(localStorage.getItem('lifehex_token_expiry') ?? '0');
    if (expiry - Date.now() < REFRESH_MARGIN_MS) {
      await refreshAccessToken();
    }
  }, CHECK_INTERVAL_MS);
}

// ─── OAuth popup (authorization code flow + PKCE) ─────────────────────────────

export async function openOAuthPopup(): Promise<string> {
  const { verifier, challenge } = await generatePKCE();
  // Store verifier so exchangeCodeForTokens can read it after popup closes
  sessionStorage.setItem('lifehex_pkce_verifier', verifier);

  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'google_oauth',
      'width=500,height=600,top=100,left=100'
    );

    if (!popup) {
      reject(new Error('Popup blocked — allow popups for this site and try again'));
      return;
    }

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'lifehex_oauth_code') {
        window.removeEventListener('message', handler);
        clearInterval(closeCheck);
        resolve(event.data.code as string);
      }
    };
    window.addEventListener('message', handler);

    const closeCheck = setInterval(() => {
      if (popup.closed) {
        clearInterval(closeCheck);
        window.removeEventListener('message', handler);
        reject(new Error('Sign-in cancelled'));
      }
    }, 500);
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const verifier = sessionStorage.getItem('lifehex_pkce_verifier') ?? '';
  sessionStorage.removeItem('lifehex_pkce_verifier');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.status.toString());
    throw new Error(`Token exchange failed: ${text}`);
  }

  return response.json();
}
