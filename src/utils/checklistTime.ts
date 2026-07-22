interface TimeWindow {
  startHour: number; // 24h
  endHour: number;   // 24h
  defaultTime: string | null; // "HH:MM" or null — null means never log a time
}

const TIME_WINDOWS: Record<string, TimeWindow> = {
  breakfast:   { startHour: 6,  endHour: 11, defaultTime: '09:30' },
  morningMeds: { startHour: 6,  endHour: 11, defaultTime: '09:15' },
  lunch:       { startHour: 11, endHour: 15, defaultTime: '12:30' },
  arvoMeds:    { startHour: 11, endHour: 15, defaultTime: '13:00' },
  dinner:      { startHour: 17, endHour: 21, defaultTime: '18:30' },
  ssri:        { startHour: 0,  endHour: 24, defaultTime: null },
};

// Returns the time to log as an ISO string, or null if no time should be stored.
// Within the defined window: logs the exact current time.
// Outside the window: logs a sensible default for that item (silently, no UI indicator).
// SSRI and any item with defaultTime null: always returns null.
export function resolveChecklistTime(itemKey: string): string | null {
  const win = TIME_WINDOWS[itemKey];
  if (!win) return new Date().toISOString();
  if (win.defaultTime === null) return null;

  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  if (currentHour >= win.startHour && currentHour < win.endHour) {
    return now.toISOString();
  }

  // Outside window — build a full ISO for today at the default HH:MM
  const [h, m] = win.defaultTime.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
