// Solar position, equation of time and civil-time helpers.
// Pure functions, no DOM: usable from the browser and from Node (tests, build).
//
// Algorithm: NOAA / Meeus "Astronomical Algorithms" ch. 25 (low precision).
// Accuracy ~0.01° in declination and a few seconds in the equation of time,
// far better than any physical sundial can show.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
const sind = (d) => Math.sin(d * DEG);
const cosd = (d) => Math.cos(d * DEG);
const tand = (d) => Math.tan(d * DEG);

export const norm360 = (a) => ((a % 360) + 360) % 360;
export const norm180 = (a) => norm360(a + 180) - 180;

/**
 * UTC time (ms) of a calendar date. Like Date.UTC, but the years 0-99 are the years 0-99, not 1900-1999
 * (a date typed as "0050-01-01" must not turn into 1950).
 */
export function utcMs(y, mo, d = 1, h = 0, mi = 0) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo, d);
  dt.setUTCHours(h, mi, 0, 0);
  return dt.getTime();
}

/** Julian day from a Unix timestamp in milliseconds. */
export function julianDay(ms) {
  return ms / 86400000 + 2440587.5;
}

/**
 * Sun declination (deg), equation of time (minutes, apparent − mean),
 * apparent ecliptic longitude (deg) and obliquity (deg) at instant `ms`.
 */
export function solarParams(ms) {
  const T = (julianDay(ms) - 2451545.0) / 36525; // Julian centuries since J2000
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032)); // mean longitude
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T); // mean anomaly
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T); // orbit eccentricity
  const C =
    sind(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    sind(2 * M) * (0.019993 - 0.000101 * T) +
    sind(3 * M) * 0.000289; // equation of centre
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sind(omega); // apparent longitude
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosd(omega); // obliquity of the ecliptic
  const decl = Math.asin(sind(eps) * sind(lambda)) * RAD;
  const y = tand(eps / 2) ** 2;
  const eotRad =
    y * sind(2 * L0) -
    2 * e * sind(M) +
    4 * e * y * sind(M) * cosd(2 * L0) -
    0.5 * y * y * sind(4 * L0) -
    1.25 * e * e * sind(2 * M);
  return { decl, eot: 4 * eotRad * RAD, lambda: norm360(lambda), eps };
}

/**
 * Unit vector towards the sun in local horizon coordinates [east, north, up].
 * decl: solar declination, H: hour angle (0 at local apparent noon, + afternoon),
 * lat: latitude. All in degrees.
 */
export function sunVector(decl, H, lat) {
  const cd = cosd(decl), sd = sind(decl), cp = cosd(lat), sp = sind(lat);
  const ch = cosd(H), sh = sind(H);
  return [-cd * sh, cp * sd - sp * cd * ch, sp * sd + cp * cd * ch];
}

/** Altitude and azimuth (from north, clockwise) in degrees of an ENU vector. */
export function altAz(s) {
  return { alt: Math.asin(Math.max(-1, Math.min(1, s[2]))) * RAD, az: norm360(Math.atan2(s[0], s[1]) * RAD) };
}

/** Local apparent hour angle (deg) at instant ms for longitude lon (deg, east +). */
export function hourAngleAt(ms, lon, eot) {
  const utcMin = (((ms / 60000) % 1440) + 1440) % 1440;
  return norm180((utcMin + 4 * lon + eot) / 4 - 180);
}

/** Everything about the sun at an instant and place. */
export function sunAt(ms, lat, lon) {
  const { decl, eot } = solarParams(ms);
  const H = hourAngleAt(ms, lon, eot);
  const vec = sunVector(decl, H, lat);
  const { alt, az } = altAz(vec);
  const solarMin = norm360(H + 180) * 4; // apparent solar time, minutes after midnight
  return { decl, eot, H, vec, alt, az, solarMin };
}

/** Hour angle of sunset (deg, geometric). 180 = sun never sets, 0 = never rises. */
export function sunsetHourAngle(lat, decl) {
  const c = -tand(lat) * tand(decl);
  if (c <= -1) return 180;
  if (c >= 1) return 0;
  return Math.acos(c) * RAD;
}

// ---- Reference year for dial curves (any non-leap year near today works) ----
export const REF_YEAR = 2027;
/** Day index (0 = Jan 1) of month mo (0-based), day d in the reference year (29 Feb, absent there, is 1 Mar). */
export const dayOfYear = (mo, d) => Math.round((Date.UTC(REF_YEAR, mo, d) - Date.UTC(REF_YEAR, 0, 1)) / 86400000);

/** Noon UTC on day index i (0 = Jan 1) of the reference year. */
export function dayMs(i, year = REF_YEAR) {
  return utcMs(year, 0, 1 + i, 12);
}

// ---- Civil time / daylight saving ----
function lastSunday(y, m) {
  const d = new Date(utcMs(y, m + 1, 0));
  return d.getUTCDate() - d.getUTCDay();
}
function nthSunday(y, m, n) {
  const first = new Date(utcMs(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

export const DST_RULES = ['EU', 'US', 'AU', 'none'];

/**
 * Minutes to add to apparent solar time (before EoT) to get zone standard time.
 * The longitude difference is wrapped to ±180°: east of the date line a zone can sit
 * "the other way round" (Samoa: lon -172°, UTC+13, zone meridian 195° = -165°), and
 * the raw difference would be 360° off, i.e. 24 hours.
 */
export const lonCorrection = (lon, tz) => -4 * norm180(lon - 15 * tz);

/**
 * The correction to apply through the (reference) year, one entry per day, noon UTC:
 * minutes to add to a dial reading to get the standard (winter) clock time.
 *   solar: reading of the apparent-solar-time lines = lonCorrection − EoT
 *   zone:  reading of the zone-time lines           = −EoT
 *   dst:   summer time is in force, so add 60 more minutes
 * Used by the correction table and the correction chart, so they cannot disagree.
 */
export function yearCorrections(lon, tz, rule) {
  const out = [];
  for (let i = 0; i < 365; i++) {
    const ms = dayMs(i), { eot } = solarParams(ms);
    out.push({ i, eot, ...correctionAt(lon, tz, eot), dst: rule !== 'none' && isDst(ms, tz, rule) });
  }
  return out;
}

/** The same correction at one instant, given the equation of time then (minutes): { solar, zone }. The one place the formulas live. */
export const correctionAt = (lon, tz, eot) => ({ solar: lonCorrection(lon, tz) - eot, zone: -eot });

/** The other way round: the hour angle (deg) of the sun at standard clock time zoneMin (minutes after midnight), from correctionAt. */
export const hourAngleAtClock = (zoneMin, lon, tz, eot) => (zoneMin - correctionAt(lon, tz, eot).solar - 720) / 4;

/** Format minutes after midnight as HH:MM (wraps around 24 h, rounds to the minute). */
export function fmtHM(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Is daylight saving active at UTC instant ms, for standard offset tz (h) and rule? */
export function isDst(ms, tz, rule) {
  const y = new Date(ms).getUTCFullYear();
  const H = 3600000;
  if (rule === 'EU') {
    return ms >= utcMs(y, 2, lastSunday(y, 2), 1) && ms < utcMs(y, 9, lastSunday(y, 9), 1);
  }
  if (rule === 'US') {
    const start = utcMs(y, 2, nthSunday(y, 2, 2), 2) - tz * H;
    const end = utcMs(y, 10, nthSunday(y, 10, 1), 1) - tz * H;
    return ms >= start && ms < end;
  }
  if (rule === 'AU') {
    // southern hemisphere: first Sunday of October → first Sunday of April
    const start = utcMs(y, 9, nthSunday(y, 9, 1), 2) - tz * H;
    const end = utcMs(y, 3, nthSunday(y, 3, 1), 2) - tz * H;
    return ms >= start || ms < end;
  }
  return false;
}

export function utcOffsetHours(ms, tz, rule) {
  return tz + (isDst(ms, tz, rule) ? 1 : 0);
}

/** Civil (wall clock) date/time at the site for UTC instant ms. */
export function civilFromUtc(ms, tz, rule) {
  const off = utcOffsetHours(ms, tz, rule);
  const d = new Date(ms + off * 3600000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
    off, dst: off !== tz,
  };
}

/** UTC instant for a civil date/time at the site. */
export function utcFromCivil(y, mo, d, h, mi, tz, rule) {
  const base = utcMs(y, mo, d, h, mi) - tz * 3600000;
  return isDst(base - 3600000, tz, rule) ? base - 3600000 : base;
}
