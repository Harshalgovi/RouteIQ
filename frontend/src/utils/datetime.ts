/**
 * Timestamp helpers.
 *
 * The API stores and returns every timestamp as a *naive* UTC string, e.g.
 * `"2026-10-05T14:13:55.954927"` -- no trailing `Z`, no numeric offset. That is
 * what SQLAlchemy produces for a `DateTime` column with no timezone, and the
 * backend is internally consistent: it only ever compares naive-UTC to naive-UTC.
 *
 * `new Date("2026-10-05T14:13:55")` does NOT mean that instant. Per the
 * ECMAScript spec a date-time without a timezone designator is interpreted in
 * the *local* zone, so every timestamp the UI displayed was off by the viewer's
 * UTC offset (5h30m for IST). It was not only a display problem: it silently
 * inverted logic that compares API times against `Date.now()`, so delay alerts
 * never fired for windows that had genuinely closed and the analytics
 * "overdue" count was wrong.
 *
 * These helpers read a naive string as UTC and render it in the viewer's local
 * zone, which is what an operator expects to see. Anything that already carries
 * a designator is passed through untouched, so timezone-aware values keep
 * working unchanged.
 */

/** Matches a date-time string with no timezone designator, e.g. `...T14:13:55`. */
const NAIVE_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Matches a bare date, e.g. `2026-10-05`, which is also read as UTC. */
const NAIVE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse an API timestamp into a `Date`.
 *
 * Returns `null` for a missing or unparseable value so callers can show a
 * placeholder instead of rendering `Invalid Date`.
 */
export function parseApiDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const normalised =
    NAIVE_DATE_TIME.test(raw) || NAIVE_DATE.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Epoch milliseconds for an API timestamp, or `null` when absent/unparseable.
 * Use this for comparisons against `Date.now()` so window-closing and overdue
 * checks run in the right zone.
 */
export function apiTimestampMs(
  value: string | null | undefined
): number | null {
  const parsed = parseApiDate(value);
  return parsed === null ? null : parsed.getTime();
}

/** Fallback shown wherever an API timestamp is missing or unreadable. */
const MISSING = '-';

/** `14:13` in the viewer's local zone. */
export function formatApiClock(
  value: string | null | undefined,
  placeholder: string = MISSING
): string {
  const parsed = parseApiDate(value);
  if (!parsed) return placeholder;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** `05 Oct, 14:13` in the viewer's local zone. */
export function formatApiDateTime(
  value: string | null | undefined,
  placeholder: string = MISSING
): string {
  const parsed = parseApiDate(value);
  if (!parsed) return placeholder;
  return parsed.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `05 Oct 2026` in the viewer's local zone. */
export function formatApiDate(
  value: string | null | undefined,
  placeholder: string = MISSING
): string {
  const parsed = parseApiDate(value);
  if (!parsed) return placeholder;
  return parsed.toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** True when the timestamp falls on the same local calendar day as `reference`. */
export function isSameApiLocalDay(
  value: string | null | undefined,
  reference: Date
): boolean {
  const parsed = parseApiDate(value);
  if (!parsed) return false;
  return (
    parsed.getFullYear() === reference.getFullYear() &&
    parsed.getMonth() === reference.getMonth() &&
    parsed.getDate() === reference.getDate()
  );
}

/**
 * Coerce a `<input type="datetime-local">` value to the UTC ISO string the API
 * expects.
 *
 * These inputs are genuinely *local* wall-clock times, so this is the one place
 * that must read them as local and convert, rather than reading them as UTC.
 */
export function localInputToUtcIso(
  value: string | null | undefined
): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}