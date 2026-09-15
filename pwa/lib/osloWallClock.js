/** Convert Europe/Oslo wall-clock stamps (often wrongly suffixed Z) to real UTC ISO. */

function lastSunday(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

function osloOffsetHours(year, monthIndex, day) {
  const start = lastSunday(year, 2);
  const end = lastSunday(year, 9);
  const utc = Date.UTC(year, monthIndex, day, 12);
  return utc >= start.getTime() && utc < end.getTime() ? 2 : 1;
}

export function osloLocalToIso(stamp) {
  const m = String(stamp || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const offset = osloOffsetHours(year, monthIndex, day);
  return new Date(Date.UTC(year, monthIndex, day, hour - offset, minute, second)).toISOString();
}
