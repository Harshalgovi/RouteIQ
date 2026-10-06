/**
 * Human-friendly date/time helpers for delivery time windows.
 *
 * The API stores windows as ISO datetimes. Users think in dates and clock times,
 * so the UI collects `{date, from, to}` and this module converts to and from ISO.
 *
 * Everything here works in the viewer's local zone. The API's timestamps are
 * naive UTC (see `datetime.ts`), so conversion goes through
 * `localInputToUtcIso` / `apiTimestampMs` rather than parsing raw strings.
 */
import { apiTimestampMs, localInputToUtcIso } from './datetime';

/** `2026-10-05` — the value a `<input type="date">` expects. */
function toDateInputValue(iso: string | null | undefined): string {
  const ms = apiTimestampMs(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `14:30` — the value an `<input type="time">` expects. */
function toTimeInputValue(iso: string | null | undefined): string {
  const ms = apiTimestampMs(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Split a stored window into the pieces the form binds to. */
export interface TimeWindowFields {
  date: string;
  from: string;
  to: string;
}

/** Convert a stored ISO window into form field values. */
export function windowToFields(start: string | null, end: string | null): TimeWindowFields {
  return {
    date: toDateInputValue(start),
    from: toTimeInputValue(start),
    to: toTimeInputValue(end),
  };
}

/** Emit naive UTC (no trailing `Z`), matching the API's timestamp convention. */
function toNaiveUtc(iso: string): string {
  return iso.replace(/Z$/, '');
}

/**
 * Build ISO datetimes from the form fields.
 *
 * Returns `{}` when no date is chosen so "no time window" stays expressible.
 * The start and end may sit on different dates (an overnight window such as
 * 22:00–02:00), so a `to` earlier than `from` rolls forward to the next day
 * rather than being rejected.
 */
export function fieldsToWindow(fields: TimeWindowFields): {
  time_window_start?: string;
  time_window_end?: string;
} {
  const { date, from, to } = fields;
  if (!date) return {};

  const startIso = from ? localInputToUtcIso(`${date}T${from}`) : undefined;
  let endIso = to ? localInputToUtcIso(`${date}T${to}`) : undefined;

  if (!startIso && !endIso) return {};

  // Overnight window: the end clock time is earlier than the start clock time.
  if (startIso && endIso && to && from && to <= from) {
    const nextDay = new Date(`${date}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const rolled = `${nextDay.getFullYear()}-${pad(nextDay.getMonth() + 1)}-${pad(
      nextDay.getDate()
    )}T${to}`;
    endIso = localInputToUtcIso(rolled);
  }

  const out: { time_window_start?: string; time_window_end?: string } = {};
  if (startIso) out.time_window_start = toNaiveUtc(startIso);
  if (endIso) out.time_window_end = toNaiveUtc(endIso);
  return out;
}

/** `05 Oct 2026` — the date line of a human-readable window. */
export function formatWindowDate(iso: string | null | undefined): string | null {
  const ms = apiTimestampMs(iso);
  if (ms === null) return null;
  return new Date(ms).toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** `2:00 PM` — 12-hour clock, as used in the example copy. */
export function formatWindowTime(iso: string | null | undefined): string | null {
  const ms = apiTimestampMs(iso);
  if (ms === null) return null;
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** `05 Oct 2026` for a single timestamp (delivery date, created date). */
export function formatHumanDate(iso: string | null | undefined, fallback = '—'): string {
  return formatWindowDate(iso) ?? fallback;
}

/** `2:00 PM` for a single timestamp. */
export function formatHumanTime(iso: string | null | undefined, fallback = '—'): string {
  return formatWindowTime(iso) ?? fallback;
}

/**
 * Render a window the way an operator reads it: `05 Oct 2026 · 2:00 PM – 5:00 PM`.
 * Returns the caller's fallback when the delivery has no window at all.
 */
export function formatWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  fallback = 'No time window'
): string {
  const date = formatWindowDate(start) ?? formatWindowDate(end);
  if (!date) return fallback;
  const from = formatWindowTime(start);
  const to = formatWindowTime(end);
  if (from && to) return `${date} · ${from} – ${to}`;
  if (from) return `${date} · from ${from}`;
  if (to) return `${date} · until ${to}`;
  return date;
}

/** True when the window exists but has not opened yet. */
export function isWindowUpcoming(start: string | null | undefined): boolean {
  const ms = apiTimestampMs(start);
  return ms !== null && ms > Date.now();
}