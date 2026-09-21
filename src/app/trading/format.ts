/**
 * Formatting for the Trading Dashboard. Every time is shown in exchange time
 * (IST) whatever the browser's zone, because a trade at 15:15 is a trade at
 * 15:15 on the NSE, not at 11:45 in London.
 */

const IST = 'Asia/Kolkata';

const RUPEES = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `₹1,23,456.70`, `−₹40.00`, or `—` for nothing. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : '';
  return `${sign}₹${RUPEES.format(Math.abs(value))}`;
}

/** A money figure with an explicit `+` on gains, for P&L columns. */
export function signedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value > 0 ? `+${money(value)}` : money(value);
}

export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return RUPEES.format(value);
}

export function percent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const text = `${value.toFixed(digits)}%`;
  return value > 0 ? `+${text}` : text.replace('-', '−');
}

/** `21 Sep 2026, 11:14:58` in IST. */
export function dateTime(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

/** `11:14:58` in IST. */
export function time(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

/** Today's exchange date, `YYYY-MM-DD`. */
export function todayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(now);
}

/** Calendar arithmetic on a `YYYY-MM-DD` key. IST has no DST, so UTC days are exact. */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** `pos` / `neg` / `flat` — the class a P&L figure is coloured with. */
export function tone(value: number | null | undefined): 'pos' | 'neg' | 'flat' {
  if (value === null || value === undefined || Math.abs(value) < 0.005) return 'flat';
  return value > 0 ? 'pos' : 'neg';
}
