// Wall-clock arithmetic in an IANA time zone, with no dependency. The posting window is a local
// time ("8:00 to 22:00 in New York"), and a plan has to turn it into real instants across
// daylight saving changes.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map();

function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(tz);
}

/** The local calendar fields of an instant in a zone. */
export function zonedParts(ms, tz) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: DAY_NAMES.indexOf(parts.weekday),
  };
}

/** Milliseconds to add to UTC to get local wall time at that instant. */
export function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the local wall clock in `tz` reads the given fields. Hour 24 means
 *  midnight at the end of that day. */
export function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess - tzOffsetMs(guess, tz);
  // A second pass settles instants near a daylight saving change.
  ms = guess - tzOffsetMs(ms, tz);
  return ms;
}

/** 'YYYY-MM-DD' for the local date of an instant. */
export function localDate(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function parseDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) throw new Error(`a date must look like 2026-10-02, got "${date}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 0 for Sunday through 6 for Saturday. */
export function dayOfWeek(date) {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Local hour of an instant as a fraction, so 13:30 is 13.5. */
export function localHour(ms, tz) {
  const p = zonedParts(ms, tz);
  return p.hour + p.minute / 60;
}
