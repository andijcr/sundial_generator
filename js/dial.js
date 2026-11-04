// Dial geometry: wall frame, shadow projection, and generation of every mark.
// Pure functions, no DOM.
//
// Coordinates on the dial ("dial coords"): millimetres, origin at the gnomon
// foot F (the point of the wall right behind the nodus), x to the right as you
// face the wall, y up. The nodus N sits at distance L in front of F.

import { sunVector, solarParams, sunsetHourAngle, dayMs, DEG, RAD, norm180, norm360, altAz, hourAngleAtClock, isDst } from './astro.js';

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const range = (a, b, step) => {
  const r = [];
  for (let x = a; x <= b + 1e-9; x += step) r.push(x);
  return r;
};

/** Inside this latitude the sun is north of the zenith for part of the year and south of it for the rest. */
export const TROPIC_LAT = 23.44;

/**
 * The page describes a wall by its declination from the equator-facing direction (south in the
 * northern hemisphere, north in the southern one), west positive, so the same number means the
 * mirrored wall on the other side of the equator. The maths (`wallFrame`) wants D from due south.
 * They are equal in the north, and D = 180° − Δ in the south. The conversion is its own inverse.
 */
export const absoluteDeclination = (lat, delta) => norm180(lat < 0 ? 180 - delta : delta);
export const relativeDeclination = absoluteDeclination;

// ---- Measuring a wall ----

/**
 * Wall declination from south (deg, west +) from one shadow reading: the sun's azimuth (from north, clockwise) and the
 * angle β of the shadow of a stick perpendicular to the wall, from the perpendicular, positive to the right as you face
 * the wall. With β = 0 the sun is straight in front of the wall, so the wall faces the sun's azimuth: D = az − 180.
 */
export const wallFromShadow = (sunAz, beta) => norm180(sunAz - 180 - beta);

/** A shadow at more than this angle from the perpendicular runs almost along the wall: the reading is poor. */
export const BETA_POOR = 75;

/**
 * Mean of angles (deg) around the circle, and their spread (circular standard deviation, deg): readings of 179° and −179°
 * average to 180°, not 0°. Returns { mean (−180..180), spread, n }, or null for no readings.
 */
export function circularMean(degs) {
  if (!degs.length) return null;
  const c = degs.reduce((a, d) => a + Math.cos(d * DEG), 0) / degs.length, s = degs.reduce((a, d) => a + Math.sin(d * DEG), 0) / degs.length;
  const R = Math.min(1, Math.hypot(c, s));
  return { mean: norm180(Math.atan2(s, c) * RAD), spread: R > 1e-12 ? Math.sqrt(-2 * Math.log(R)) * RAD : 180, n: degs.length };
}

/**
 * Magnetic compass heading (deg from north, clockwise) of the top of a phone lying flat, from a deviceorientation event:
 * iOS gives it directly (webkitCompassHeading); elsewhere an absolute event's alpha turns the other way (heading = 360 − α).
 * null when the event carries no heading (not absolute, no magnetometer).
 */
export function compassHeading(e) {
  if (e && Number.isFinite(e.webkitCompassHeading)) return norm360(e.webkitCompassHeading);
  if (e && e.absolute && Number.isFinite(e.alpha)) return norm360(360 - e.alpha);
  return null;
}

/** Largest |Δ| offered. Walls facing away from the sun are only offered inside the tropics. */
export const wallLimit = (lat) => (Math.abs(lat) < TROPIC_LAT ? 180 : 90);

/**
 * Orthonormal frame of a vertical wall with declination D (deg, 0 = facing
 * south, +90 = facing west, −90 = facing east, 180 = facing north).
 * Vectors in [east, north, up]. n: outward normal, u: right (as you face the
 * wall), v: up.
 */
export function wallFrame(D) {
  const s = Math.sin(D * DEG), c = Math.cos(D * DEG);
  return { n: [-s, -c, 0], u: [c, -s, 0], v: [0, 0, 1] };
}

/**
 * The vertical blade gnomon is a flat fin standing in the plane that holds the
 * wall normal and the vertical. Its lower edge runs from the foot F out to the
 * nodus (distance L); its upper edge slopes back to the wall at height h above F.
 * Only the tip (nodus) is read, so the dial itself is the same as for a rod.
 * h = r·L, with r the setting `bladeR` (default 1: a 45° brace). A low blade is less conspicuous,
 * a tall one stiffer; the tip, and so the dial, stays the same.
 */
export const BLADE_RATIO = 1;
export const bladeHeight = (L, r = BLADE_RATIO) => L * r;

/** Direction of the north celestial pole in [east, north, up]. */
export function poleAxis(lat) {
  return [0, Math.cos(lat * DEG), Math.sin(lat * DEG)];
}

/**
 * Shadow of the nodus for sun direction s: intersection of the ray from the
 * nodus (L·n) along −s with the wall plane. Returns [x, y] or null when the
 * sun is behind the wall or below the horizon.
 *   P = L·n − (L / (s·n))·s
 */
export function shadowPoint(s, L, fr) {
  const sn = dot(s, fr.n);
  if (sn <= 1e-9 || s[2] <= 0) return null;
  const k = L / sn;
  return [-k * dot(s, fr.u), -k * s[2]];
}

/** Root of the polar style: where the line through the nodus parallel to the
 * Earth's axis meets the wall. null if the axis is (almost) parallel to it. */
export function styleRoot(lat, L, fr) {
  const p = poleAxis(lat);
  const pn = dot(p, fr.n);
  if (Math.abs(pn) < 0.02) return null;
  const k = L / pn;
  return [-k * dot(p, fr.u), -k * p[2]];
}

/** Classical dialling angles of a vertical declining dial (degrees). */
export function dialAngles(lat, D) {
  const fr = wallFrame(D);
  const p = poleAxis(lat);
  const pn = dot(p, fr.n);
  const SH = Math.asin(Math.min(1, Math.abs(pn))) * RAD; // style height
  // substyle: direction from F to the root, measured from the upward vertical, + to the right
  const R = styleRoot(lat, 1, fr);
  const SD = R ? Math.atan2(R[0], R[1]) * RAD : 90 * Math.sign(-dot(p, fr.u) || 1);
  // longitude difference: hour angle of the sun when it lies in the plane through the substyle
  const DL = Math.atan2(Math.sin(D * DEG), Math.sin(lat * DEG) * Math.cos(D * DEG)) * RAD;
  return { SH, SD, DL };
}

// ---- Year table (reference year) ----
let YEAR = null;
export function yearTable() {
  if (!YEAR) {
    YEAR = [];
    for (let i = 0; i < 365; i++) {
      const ms = dayMs(i);
      const d = new Date(ms);
      const { decl, eot, lambda } = solarParams(ms);
      YEAR.push({ i, decl, eot, lambda, m: d.getUTCMonth(), dom: d.getUTCDate() });
    }
  }
  return YEAR;
}
/**
 * Hour angle (deg) of the sun on day i of the reference year when a wall clock at the site shows `minutes` after midnight:
 * summer time (rule) is taken off first, then hourAngleAtClock (astro.js) applies the longitude and the equation of time.
 * This is what a phone shows, so the wall-clock figure-8s and the 10-minute ticks are drawn from it.
 */
export function wallClockHourAngle(i, minutes, lon, tz, rule) {
  return hourAngleAtClock(minutes - (summerFlags(tz, rule)[i] ? 60 : 0), lon, tz, yearTable()[i].eot);
}
// Is summer time in force on day i of the reference year (at noon UTC)? Cached per time zone and rule: the wall-clock 8s ask
// for every day of every hour, and fitPlateToPage builds the dial hundreds of times.
const SUMMER = new Map();
function summerFlags(tz, rule) {
  const key = `${tz}|${rule}`;
  if (!SUMMER.has(key)) SUMMER.set(key, yearTable().map((d) => rule !== 'none' && isDst(dayMs(d.i), tz, rule)));
  return SUMMER.get(key);
}

/**
 * The wall-clock figure-8s are on: they read what a phone shows (summer time included) at the rod's tip, and replace the
 * straight hour lines and the other figure-8s (whose controls are then disabled). Rod only. Used by the dial, the sheets
 * and the controls.
 */
export const clockOn = (s) => !!(s.anaClock && s.gRod);

export function declLimits() {
  const Y = yearTable();
  let min = Infinity, max = -Infinity;
  for (const d of Y) { min = Math.min(min, d.decl); max = Math.max(max, d.decl); }
  return { min, max };
}

// ---- Polyline helpers ----
function clipSeg(p, q, r) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const P = [-dx, dx, -dy, dy];
  const Q = [p[0] - r.x0, r.x1 - p[0], p[1] - r.y0, r.y1 - p[1]];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return null; }
    else {
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy], t0 > 0, t1 < 1];
}

/** Clip a polyline to rectangle r = {x0,x1,y0,y1}; returns a list of polylines. */
export function clipPolyline(pts, r) {
  const out = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const c = clipSeg(pts[i], pts[i + 1], r);
    if (!c) { if (cur) { out.push(cur); cur = null; } continue; }
    const [a, b, late, early] = c;
    if (!cur || late) { if (cur) out.push(cur); cur = [a]; }
    cur.push(b);
    if (early) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length > 1);
}
const clipAll = (lines, r) => lines.flatMap((l) => clipPolyline(l, r));

/** Evaluate fn over params, splitting into polylines where fn returns null. */
function trace(params, fn, lim) {
  const lines = [];
  let cur = [];
  for (const p of params) {
    const pt = fn(p);
    if (pt && Math.abs(pt[0]) < lim && Math.abs(pt[1]) < lim) cur.push(pt);
    else { if (cur.length > 1) lines.push(cur); cur = []; }
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

const ROMAN = ['XXIV', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII'];

/**
 * Bounding box (for L = 1, origin at F) of the useful shadow region:
 * nodus shadows over the year while the sun is at least `grazing` degrees
 * off the wall plane and 2° above the horizon. Used for auto-fitting.
 */
export function coreBBox(lat, D, grazing, includeRoot, extraTop = 0) {
  const fr = wallFrame(D);
  const { min, max } = declLimits();
  const sg = Math.sin(grazing * DEG), sa = Math.sin(2 * DEG);
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0, n = 0;
  for (let d = min; d <= max + 1e-9; d += (max - min) / 24) {
    for (let H = -180; H < 180; H += 2) {
      const s = sunVector(d, H, lat);
      if (s[2] < sa || dot(s, fr.n) < sg) continue;
      const p = shadowPoint(s, 1, fr);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      n++;
    }
  }
  if (includeRoot) {
    const R = styleRoot(lat, 1, fr);
    if (R && Math.hypot(R[0], R[1]) < 6) {
      x0 = Math.min(x0, R[0]); x1 = Math.max(x1, R[0]);
      y0 = Math.min(y0, R[1]); y1 = Math.max(y1, R[1]);
    }
  }
  y1 = Math.max(y1, extraTop); // room above the foot, e.g. for the blade (in units of L)
  return { x0, x1, y0, y1, n };
}

/** Bounds of the nodus distance L, mm: the manual setting is held to them, and so is the automatic one. */
export const L_MIN = 2, L_MAX = 3000;

/**
 * Choose nodus length L and foot position so the core region fits the plate.
 * If the grazing filter leaves no sun at all (a wall that only ever sees grazing sun, such as one facing
 * due north or south near the equator with a big grazing setting), it is relaxed step by step: dividing the
 * plate by an empty region used to give an L of metres. `relaxedTo` is the grazing limit actually used when
 * that happened (else null); `clamped` says L was held to L_MIN..L_MAX; `empty` means there is no sun even at
 * 1° (a wall the sun never reaches), where a modest size is chosen.
 */
export function autoFit(lat, D, plate, grazing, includeRoot, bottomReserve = 0, extraTop = 0) {
  let g = grazing, b = coreBBox(lat, D, g, includeRoot, extraTop);
  while (b.n === 0 && g > 1) { g = Math.max(1, g - 3); b = coreBBox(lat, D, g, includeRoot, extraTop); }
  const empty = b.n === 0;
  const bw = Math.max(b.x1 - b.x0, 0.05), bh = Math.max(b.y1 - b.y0, 0.05);
  const m = plate.margin;
  const aw = plate.w - 2 * m, ah = plate.h - 2 * m - bottomReserve;
  const wanted = empty ? Math.min(aw, ah) / 6 : Math.min(aw / bw, ah / bh);
  const L = Math.min(L_MAX, Math.max(L_MIN, wanted));
  const fx = m + -b.x0 * L + (aw - bw * L) / 2;
  const fy = m + b.y1 * L + (ah - bh * L) / 2;
  return { L, fx, fy, empty, relaxedTo: g < grazing && !empty ? g : null, clamped: L !== wanted };
}

// ---- Horizon profile and when the sun reaches the wall ----

/** At most this many points in a horizon profile. */
export const HORIZON_MAX = 36;

/**
 * Horizon profile from text: "az:alt" pairs (separated by commas, semicolons or spaces), compass azimuth (0 = north, 90 = east)
 * and the altitude of the obstacles' top, degrees. Anything that is not such a pair is ignored, azimuths are wrapped
 * to 0..360, altitudes held to 0..89, the points sorted by azimuth (a repeated azimuth keeps its last value).
 * Returns [[az, alt], ...]: what is stored and drawn never contains anything but numbers.
 */
export function parseHorizon(str) {
  const byAz = new Map();
  for (const m of String(str ?? '').matchAll(/(-?\d+(?:\.\d+)?)\s*[:=/]\s*(-?\d+(?:\.\d+)?)/g)) { // any separator between the pairs
    const az = Math.round(norm360(+m[1]) * 10) / 10 % 360, alt = Math.round(Math.min(89, Math.max(0, +m[2])) * 10) / 10;
    byAz.delete(az);
    byAz.set(az, alt);
    if (byAz.size > HORIZON_MAX) byAz.delete(byAz.keys().next().value);
  }
  return [...byAz].sort((a, b) => a[0] - b[0]);
}
/** The canonical text of a horizon profile (what the URL stores). */
export const formatHorizon = (pts) => pts.map(([a, h]) => `${a}:${h}`).join(', ');

/** Altitude of the horizon profile at compass azimuth az: linear between neighbouring points, around the circle. One point is the whole horizon; none is 0. */
export function horizonAlt(pts, az) {
  if (!pts?.length) return 0;
  if (pts.length === 1) return pts[0][1];
  const z = norm360(az);
  const j = pts.findIndex((p) => p[0] > z), b = pts[j === -1 ? 0 : j], a = pts[j <= 0 ? pts.length - 1 : j - 1];
  const span = norm360(b[0] - a[0]) || 360;
  return a[1] + (b[1] - a[1]) * (norm360(z - a[0]) / span);
}

/** The sun's state as seen from the wall. graze: on the wall, but within the auto-fit's grazing angle of its plane (long, faint shadows). */
export const SUN = { night: 0, behind: 1, hidden: 2, graze: 3, lit: 4 };
export function sunState(s, fr, hz = [], grazing = 0) {
  if (s[2] <= 0) return SUN.night;
  const sn = dot(s, fr.n);
  if (sn <= 0) return SUN.behind;
  if (hz.length) { const { alt, az } = altAz(s); if (alt <= horizonAlt(hz, az)) return SUN.hidden; }
  return sn < Math.sin(grazing * DEG) ? SUN.graze : SUN.lit;
}

/**
 * When the sun reaches the wall through the (reference) year, against standard (zone) clock time: one column every
 * `stepDays` days, one cell every `stepMin` minutes, each a SUN state. Hour angle from the clock:
 * hourAngleAtClock (astro.js). litH: hours of sun on the wall that day (grazing included); avgOpen: the average with an open horizon.
 */
export function sunlightGrid(lat, lon, tz, D, hz = [], grazing = 0, stepDays = 2, stepMin = 10) {
  const fr = wallFrame(D), Y = yearTable(), n = Math.round(1440 / stepMin);
  const cols = [];
  let open = 0; // cells that would be lit with an open horizon (lit, grazing or hidden)
  for (let i = 0; i < Y.length; i += stepDays) {
    const d = Y[i], codes = new Uint8Array(n);
    let lit = 0;
    for (let k = 0; k < n; k++) {
      codes[k] = sunState(sunVector(d.decl, hourAngleAtClock((k + 0.5) * stepMin, lon, tz, d.eot), lat), fr, hz, grazing);
      if (codes[k] >= SUN.graze) lit++;
      if (codes[k] >= SUN.hidden) open++;
    }
    cols.push({ i, codes, litH: lit * stepMin / 60 });
  }
  const avg = cols.reduce((a, c) => a + c.litH, 0) / cols.length, avgOpen = open * stepMin / 60 / cols.length;
  const max = cols.reduce((a, c) => (c.litH > a.litH ? c : a)), min = cols.reduce((a, c) => (c.litH < a.litH ? c : a));
  return { stepDays, stepMin, n, cols, avg, avgOpen, max, min };
}

/** Hours of sun on the wall (above the horizon profile hz, if any), averaged per day over the year, and daylight hours. */
export function sunStats(lat, D, hz = []) {
  const fr = wallFrame(D);
  const Y = yearTable();
  let lit = 0, day = 0, days = 0;
  for (let i = 0; i < Y.length; i += 5) {
    days++;
    for (let H = -180; H < 180; H += 2.5) {
      const s = sunVector(Y[i].decl, H, lat);
      if (s[2] > 0) { day++; if (sunState(s, fr, hz) >= SUN.graze) lit++; }
    }
  }
  const k = 10 / 60 / days; // 2.5° = 10 minutes
  return { litPerDay: lit * k, dayPerDay: day * k };
}

/** Box of a label (dial coords, mm): [x0, x1, y0, y1]. Text is centred on (x, y); the width is estimated (0.6 em per character). */
export function labelBox(lb, fs, x = lb.x, y = lb.y) {
  const [w, h] = labelSize(lb, fs);
  return [x - w / 2, x + w / 2, y - h / 2, y + h / 2];
}
const labelSize = (lb, fs) => { const z = fs * (lb.size || 1); return [[...lb.text].length * 0.6 * z + 0.15 * z, 0.85 * z]; };
const boxesHit = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];

// Which labels keep their place when two collide: the hour numbers first, then the summer-time numbers
// (which follow their hour number), the date lines, the old hours, and the small month and angle labels last.
const LABEL_RANK = { hour: 0, zone: 1, ana: 2, dst: 3, date: 4, ital: 5, bab: 5, dateMinor: 6, az: 8, alt: 8 };
const labelRank = (lb) => (lb.cls === 'ana' && lb.size ? 7 : LABEL_RANK[lb.cls] ?? 9); // a small 'ana' label is a month name

/**
 * Move labels so they do not overlap, in place. Labels are placed by rank; each stays where it was put if that is free,
 * else it goes to the nearest free spot (rings up to about 3.5 font sizes out, inside the clip box). A label with `of`
 * (a summer-time number) first moves with the label it belongs to. One that finds no free spot stays put.
 */
export function placeLabels(labels, clip, fs) {
  const order = labels.map((lb, i) => [labelRank(lb), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => labels[i]);
  const placed = [], moved = new Map();
  for (const lb of order) {
    const z = fs * (lb.size || 1), [w, h] = labelSize(lb, fs); // the size once per label: the search below tries up to 128 spots
    const box = (x, y) => [x - w / 2, x + w / 2, y - h / 2, y + h / 2];
    const free = (x, y) => { const b = box(x, y); return !placed.some((p) => boxesHit(b, p)); };
    const inside = (x, y) => x - w / 2 >= clip.x0 && x + w / 2 <= clip.x1 && y - h / 2 >= clip.y0 && y + h / 2 <= clip.y1;
    // a summer-time number follows its hour number, unless that would take it off the plate
    const d = lb.of && moved.get(lb.of);
    const follow = d && inside(lb.x + d[0], lb.y + d[1]);
    const x0 = lb.x + (follow ? d[0] : 0), y0 = lb.y + (follow ? d[1] : 0);
    let best = [x0, y0];
    if (!free(x0, y0)) {
      search: for (let k = 1; k <= 8; k++) {
        const r = 0.45 * z * k;
        for (let a = 0; a < 16; a++) {
          const x = x0 + r * Math.cos(a * Math.PI / 8), y = y0 + r * Math.sin(a * Math.PI / 8);
          if (inside(x, y) && free(x, y)) { best = [x, y]; break search; }
        }
      }
    }
    moved.set(lb, [best[0] - lb.x, best[1] - lb.y]);
    lb.x = best[0]; lb.y = best[1];
    delete lb.of;
    placed.push(box(lb.x, lb.y));
  }
}

/**
 * Compute all marks of the dial.
 * cfg: { lat, lon, tz, D, L, plate:{w,h,fx,fy,margin}, fontSize, opts, t }
 * Returns { frame, root, angles, layers:[{id,cls,lines,labels}], clip, warnings, stats }.
 */
export function computeDial(cfg) {
  const { lat, lon, tz, D, L, plate: P, opts: o, t } = cfg;
  const fs = cfg.fontSize;
  const fr = wallFrame(D);
  const root = styleRoot(lat, L, fr);
  const angles = dialAngles(lat, D);
  const m = P.margin;
  const clip = { x0: -P.fx + m, x1: P.w - P.fx - m, y0: P.fy - P.h + m + (cfg.bottomReserve || 0), y1: P.fy - m };
  const lim = 40 * Math.max(P.w, P.h);
  const { min: dMin, max: dMax } = declLimits();
  const declRange = range(dMin, dMax, (dMax - dMin) / 48);
  const SP = (d, H) => shadowPoint(sunVector(d, H, lat), L, fr);
  const zoneShift = lon - 15 * tz; // degrees of hour angle between local and zone meridian
  const ref = root && Math.hypot(root[0], root[1]) < 10 * L ? root : [0, 0];
  const layers = [];
  const add = (id, cls, lines, labels = []) => layers.push({ id, cls, lines, labels });
  const south = lat < 0;
  const months = t('monthsShort');

  const clampIn = (p) => [
    Math.min(clip.x1 - fs * 0.6, Math.max(clip.x0 + fs * 0.6, p[0])),
    Math.min(clip.y1 - fs * 0.6, Math.max(clip.y0 + fs * 0.6, p[1])),
  ];
  // label just beyond the end of the clipped lines that is farthest from refPt
  function labelAtEnd(lines, refPt, off) {
    let best = null, bd = -1;
    for (const l of lines) {
      for (const [a, b] of [[l[0], l[1]], [l[l.length - 1], l[l.length - 2]]]) {
        const d = dist(a, refPt);
        if (d > bd) { bd = d; best = [a, b]; }
      }
    }
    if (!best) return null;
    const [a, b] = best;
    const dx = a[0] - b[0], dy = a[1] - b[1], n = Math.hypot(dx, dy) || 1;
    const dir = [dx / n, dy / n];
    return { p: clampIn([a[0] + dir[0] * off, a[1] + dir[1] * off]), dir };
  }
  // label on a curve at fraction f of its (first clipped piece's) length, offset sideways
  function labelAlong(lines, f, side) {
    if (!lines.length) return null;
    const l = lines.reduce((a, b) => (b.length > a.length ? b : a));
    let total = 0;
    for (let i = 1; i < l.length; i++) total += dist(l[i - 1], l[i]);
    let acc = 0;
    for (let i = 1; i < l.length; i++) {
      const seg = dist(l[i - 1], l[i]);
      if (acc + seg >= total * f) {
        const dx = (l[i][0] - l[i - 1][0]) / (seg || 1), dy = (l[i][1] - l[i - 1][1]) / (seg || 1);
        let nx = -dy, ny = dx;
        if (ny < 0) { nx = -nx; ny = -ny; } // offset "upwards"
        return clampIn([l[i][0] + nx * side, l[i][1] + ny * side]);
      }
      acc += seg;
    }
    return null;
  }
  const hourText = (h) => {
    const hh = ((Math.round(h) % 24) + 24) % 24;
    return o.hRoman ? ROMAN[hh] : String(hh);
  };

  // ---------- Hour lines ----------
  // Wall-clock figure-8s (rod only) replace every other time line: the straight hour lines and the other figure-8s.
  const clock = clockOn(o);
  function hourSet(id, shift, cls, dstLabels) {
    const step = o.hTen ? 1 / 6 : o.hQuarter ? 0.25 : o.hHalf ? 0.5 : 1;
    const major = [], minor = [], fine = [], ext = [], labels = [];
    for (let h = 0; h < 24 - 1e-9; h += step) {
      const H = 15 * (h - 12) + shift;
      const raw = trace(declRange, (d) => SP(d, H), lim);
      if (!raw.length) continue;
      const isMajor = Math.abs(h - Math.round(h)) < 1e-6, isHalf = Math.abs(2 * h - Math.round(2 * h)) < 1e-6;
      const clipped = clipAll(raw, clip);
      // hours bold and labelled, half hours (and quarters) medium, 10-minute lines hairline and unlabelled
      (isMajor ? major : isHalf || !o.hTen ? minor : fine).push(...clipped);
      if (o.hExtend && o.gPolar && root && isMajor && clipped.length) {
        let near = null, nd = Infinity;
        for (const l of raw) for (const pt of [l[0], l[l.length - 1]]) {
          const d = dist(pt, root);
          if (d < nd) { nd = d; near = pt; }
        }
        if (near) ext.push(...clipPolyline([root, near], clip));
      }
      if (isMajor && clipped.length) {
        const lb = labelAtEnd(clipped, ref, fs * 0.9);
        if (lb) {
          const main = { x: lb.p[0], y: lb.p[1], text: hourText(h), cls };
          labels.push(main);
          if (dstLabels) {
            const q = clampIn([lb.p[0] - lb.dir[1] * fs * 1.1, lb.p[1] + lb.dir[0] * fs * 1.1]);
            labels.push({ x: q[0], y: q[1], text: hourText(h + 1), cls: 'dst', size: 0.75, of: main });
          }
        }
      }
    }
    add(id + 'Ext', cls + 'Ext', ext);
    add(id + 'Fine', cls + 'Fine', fine);
    add(id + 'Minor', cls + 'Minor', minor);
    add(id, cls, major, labels);
  }
  if (o.hSolar && !clock) hourSet('hourSolar', 0, 'hour', false);
  if (o.hZone && !clock) hourSet('hourZone', zoneShift, 'zone', o.hDstLabels);

  // ---------- Declination (date) curves ----------
  const Hs = range(-180, 180, 1);
  const zodiacSym = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'].map((c) => c + '︎');
  function declCurve(decl, text, cls, f) {
    const lines = clipAll(trace(Hs, (H) => SP(decl, H), lim), clip);
    const labels = [];
    if (text) {
      const p = labelAlong(lines, f, fs * 0.55);
      if (p) labels.push({ x: p[0], y: p[1], text, cls, size: 0.7 });
    }
    return { lines, labels };
  }
  function addCurves(id, cls, list) {
    const lines = [], labels = [];
    for (const [d, txt, f] of list) {
      const c = declCurve(d, txt, cls, f);
      lines.push(...c.lines); labels.push(...c.labels);
    }
    add(id, cls, lines, labels);
  }
  if (o.dSolEq) {
    const z = o.dZodiac;
    addCurves('dateMain', 'date', [
      [dMax, (south ? t('winterSolstice') : t('summerSolstice')) + (z ? ' ' + zodiacSym[3] : ''), 0.15],
      [0, t('equinox') + (z ? ' ' + zodiacSym[0] + zodiacSym[6] : ''), 0.15],
      [dMin, (south ? t('summerSolstice') : t('winterSolstice')) + (z ? ' ' + zodiacSym[9] : ''), 0.15],
    ]);
  }
  if (o.dZodiac) {
    const eps = 23.4393;
    const zd = (lam) => Math.asin(Math.sin(eps * DEG) * Math.sin(lam * DEG)) * RAD;
    const list = [[30, 1, 5], [60, 2, 4], [210, 7, 11], [240, 8, 10]].map(([lam, a, b]) => [zd(lam), zodiacSym[a] + ' ' + zodiacSym[b], 0.85]);
    if (!o.dSolEq) list.push([dMax, zodiacSym[3], 0.85], [0, zodiacSym[0] + ' ' + zodiacSym[6], 0.85], [dMin, zodiacSym[9], 0.85]);
    addCurves('dateZodiac', 'dateMinor', list);
  }
  const ticks10 = clock && o.dTicks10; // the ticks sit on the month-start lines, so those are drawn with them
  if (o.dMonths || ticks10) {
    const Y = yearTable();
    const list = Y.filter((d) => d.dom === 1).map((d) => [d.decl, '1 ' + months[d.m], d.m < 6 ? 0.55 : 0.4]);
    addCurves('dateMonths', 'dateMinor', list);
  }

  // ---------- Analemmas ----------
  // Hof(i): the hour angle on day i. A jump between two days (summer time starts or ends, 15°) breaks the curve there.
  // summer(i), for the wall-clock 8s: summer time is in force on day i. Those parts are drawn lighter, and every piece of the
  // curve gets its hour number (at the winter end and on both sides of each jump), because where summer time starts or ends
  // the curve of one hour carries on where another hour's curve was: following a line across a jump changes the hour.
  function analemma(Hof, hourLabel, monthLabels, dstLabel, summer = null) {
    const Y = yearTable();
    const Hs8 = Y.map((d, i) => Hof(i));
    const pts = Y.map((d, i) => SP(d.decl, Hs8[i]));
    const jump = (i, j) => Math.abs(norm180(Hs8[j] - Hs8[i])) > 5;
    const parts = { R: [], F: [], Rs: [], Fs: [] }, jumps = []; // rising / falling branch, s: summer time
    let cur = null, curKey = null;
    for (let i = 0; i < Y.length; i++) {
      const j = (i + 1) % Y.length;
      const a = pts[i], b = pts[j];
      if (a && b && jump(i, j)) jumps.push(i, j); // the two ends of the jump get a bar across the line (and labels)
      if (!a || !b || jump(i, j) || Math.abs(a[0]) > lim || Math.abs(b[0]) > lim || Math.abs(a[1]) > lim || Math.abs(b[1]) > lim) {
        if (cur) parts[curKey].push(cur);
        cur = null; continue;
      }
      const key = (Y[j].decl > Y[i].decl ? 'R' : 'F') + (summer && summer(i) ? 's' : '');
      if (!cur || key !== curKey) {
        if (cur) parts[curKey].push(cur);
        cur = [a]; curKey = key;
      }
      cur.push(b);
    }
    if (cur) parts[curKey].push(cur);
    const valid = pts.filter(Boolean);
    if (!valid.length) return;
    const cx = valid.reduce((s, p) => s + p[0], 0) / valid.length;
    const cy = valid.reduce((s, p) => s + p[1], 0) / valid.length;
    const ticks = [], labels = [];
    if (o.anaMonthTicks) {
      for (let i = 0; i < Y.length; i++) {
        if (Y[i].dom !== 1 || !pts[i]) continue;
        const ip = (i + Y.length - 1) % Y.length, inx = (i + 1) % Y.length;
        // the tangent from the neighbours, but not across a summer-time jump
        const a = jump(ip, i) ? pts[i] : pts[ip], b = jump(i, inx) ? pts[i] : pts[inx];
        if (!a || !b || a === b) continue;
        const tx = b[0] - a[0], ty = b[1] - a[1], tn = Math.hypot(tx, ty) || 1;
        let nx = -ty / tn, ny = tx / tn;
        const p = pts[i];
        if ((p[0] - cx) * nx + (p[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
        const tl = fs * 0.5;
        ticks.push([p, [p[0] + nx * tl, p[1] + ny * tl]]);
        if (monthLabels === true || (monthLabels && monthLabels.includes(Y[i].m))) { // all months, or the listed ones
          const q = [p[0] + nx * (tl + fs * 0.7), p[1] + ny * (tl + fs * 0.7)];
          if (q[0] > clip.x0 && q[0] < clip.x1 && q[1] > clip.y0 && q[1] < clip.y1) labels.push({ x: q[0], y: q[1], text: months[Y[i].m], cls: 'ana', size: 0.6 });
        }
      }
    }
    const onPlate = (q) => q && q[0] >= clip.x0 && q[0] <= clip.x1 && q[1] >= clip.y0 && q[1] <= clip.y1;
    if (hourLabel && summer) {
      // the winter (shortest shadow) end of the part on the plate gets the number too
      let k = -1;
      Y.forEach((d, i) => { if (onPlate(pts[i]) && (k < 0 || d.decl < Y[k].decl)) k = i; });
      if (k >= 0) {
        const p = pts[k], dx = p[0] - cx, dy = p[1] - cy, n = Math.hypot(dx, dy) || 1;
        const q = clampIn([p[0] + (dx / n) * fs * 0.8, p[1] + (dy / n) * fs * 0.8]);
        labels.push({ x: q[0], y: q[1], text: hourLabel, cls: 'ana', size: 0.8 });
      }
      // and each side of a jump: a little way into its own piece, beside the line (away from the 8's middle)
      for (let k = 0; k < jumps.length; k += 2) {
        for (const [e, inward] of [[jumps[k], (jumps[k] + Y.length - 3) % Y.length], [jumps[k + 1], (jumps[k + 1] + 3) % Y.length]]) {
          const p = pts[e], q0 = pts[inward];
          if (!onPlate(p) || !q0) continue;
          const tx = q0[0] - p[0], ty = q0[1] - p[1], tn = Math.hypot(tx, ty) || 1;
          let nx = -ty / tn, ny = tx / tn;
          if ((p[0] - cx) * nx + (p[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
          const q = clampIn([p[0] + (tx / tn) * fs * 1.2 + nx * fs * 0.7, p[1] + (ty / tn) * fs * 1.2 + ny * fs * 0.7]);
          labels.push({ x: q[0], y: q[1], text: hourLabel, cls: 'ana', size: 0.7 });
        }
      }
    }
    if (hourLabel) {
      // put the hour number beyond the summer (longest shadow) end of the part of the 8 that is on the plate; none on the plate, no label
      let k = -1;
      Y.forEach((d, i) => { if (onPlate(pts[i]) && (k < 0 || d.decl > Y[k].decl)) k = i; });
      if (k >= 0) {
        const p = pts[k];
        const dx = p[0] - cx, dy = p[1] - cy, n = Math.hypot(dx, dy) || 1;
        const q = clampIn([p[0] + (dx / n) * fs * 0.9, p[1] + (dy / n) * fs * 0.9]);
        const main = { x: q[0], y: q[1], text: hourLabel, cls: 'ana' };
        labels.push(main);
        if (dstLabel) {
          const q2 = clampIn([q[0] + fs * 1.1, q[1]]);
          labels.push({ x: q2[0], y: q2[1], text: dstLabel, cls: 'dst', size: 0.75, of: main });
        }
      }
    }
    // a bar across the curve at each end of a summer-time jump, so the change dates are visible
    for (let k = 0; k < jumps.length; k += 2) {
      const [p, q] = [pts[jumps[k]], pts[jumps[k + 1]]];
      for (const e of [p, q]) {
        const i = pts.indexOf(e), o2 = pts[(i + Y.length + (e === p ? -1 : 1)) % Y.length] || e;
        const tx = e[0] - o2[0], ty = e[1] - o2[1], tn = Math.hypot(tx, ty) || 1, bl = fs * 0.45;
        ticks.push([[e[0] - (ty / tn) * bl, e[1] + (tx / tn) * bl], [e[0] + (ty / tn) * bl, e[1] - (tx / tn) * bl]]);
      }
    }
    add('anaR', 'anaR', clipAll(parts.R, clip));
    add('anaF', 'anaF', clipAll(parts.F, clip), labels);
    if (summer) { add('anaRs', 'anaRs', clipAll(parts.Rs, clip)); add('anaFs', 'anaFs', clipAll(parts.Fs, clip)); }
    add('anaTicks', 'tick', clipAll(ticks, clip));
  }
  const Y8 = yearTable(), mean = (H0) => (i) => H0 + 0.25 * Y8[i].eot; // a fixed mean (zone) time: the equation of time only
  if (clock) {
    // what a wall clock (a phone) shows, summer time included: one 8 per clock hour, with a jump at each change date
    // month names: all of them on the 12 o'clock 8, and February, May, August and November (one a season) on the others, so the
    // branch that holds today's date can be found on any 8 without crowding the winter end, where they all meet
    const sf = summerFlags(tz, o.dst);
    for (let h = 0; h < 24; h++) analemma((i) => wallClockHourAngle(i, h * 60, lon, tz, o.dst), hourText(h), h === 12 ? true : [1, 4, 7, 10], null, (i) => sf[i]);
  } else {
    const noonCount = (o.anaMeanNoon ? 1 : 0) + (o.anaZoneNoon || o.anaHours ? 1 : 0);
    if (o.anaMeanNoon) analemma(mean(0), noonCount > 1 ? t('meanNoonShort') : null, true, null);
    if (o.anaHours) {
      for (let h = 0; h < 24; h++) analemma(mean(15 * (h - 12) + zoneShift), hourText(h), h === 12, o.hDstLabels ? hourText(h + 1) : null);
    } else if (o.anaZoneNoon) {
      analemma(mean(zoneShift), hourText(12), true, o.hDstLabels ? hourText(13) : null);
    }
  }

  // ---------- 10-minute ticks on the month-start lines (with the wall-clock figure-8s) ----------
  // On the date line of the 1st of each month, a tick every 10 minutes of wall-clock time on that date: long on the hour,
  // medium on the half hour. Two months of the year share nearly the same line but not the same times, so January to June
  // tick on the upper side of their lines and July to December on the lower side.
  if (ticks10) {
    const tk = [];
    for (const d of Y8.filter((x) => x.dom === 1)) {
      // the normal to the left of the shadow's direction of travel through the day; the line's "upper" side is decided once,
      // for the whole line (where most of its normals point up), so a line that turns steep keeps its ticks on one side
      const marks = [];
      for (let T = 0; T < 1440; T += 10) {
        const H = wallClockHourAngle(d.i, T, lon, tz, o.dst);
        const p = SP(d.decl, H), a = SP(d.decl, H - 0.5), b = SP(d.decl, H + 0.5);
        if (!p || !a || !b || p[0] < clip.x0 || p[0] > clip.x1 || p[1] < clip.y0 || p[1] > clip.y1) continue;
        const tx = b[0] - a[0], ty = b[1] - a[1], tn = Math.hypot(tx, ty) || 1;
        marks.push({ p, n: [-ty / tn, tx / tn], T });
      }
      const up = marks.reduce((acc, m) => acc + m.n[1], 0) >= 0 ? 1 : -1;
      const side = (d.m < 6 ? 1 : -1) * up;
      for (const { p, n, T } of marks) {
        const len = (T % 60 === 0 ? 0.7 : T % 30 === 0 ? 0.5 : 0.32) * fs * side;
        tk.push([p, [p[0] + n[0] * len, p[1] + n[1] * len]]);
      }
    }
    add('clockTicks', 'clockTick', clipAll(tk, clip));
  }

  // ---------- Italian / Babylonian hours ----------
  function sunsetLines(id, cls, fromSunset) {
    const lines = [], labels = [];
    for (let k = 1; k <= 23; k++) {
      const raw = trace(declRange, (d) => {
        const H0 = sunsetHourAngle(lat, d);
        if (H0 <= 0 || H0 >= 180) return null;
        const H = fromSunset ? H0 - 15 * (24 - k) : -H0 + 15 * k;
        return SP(d, H);
      }, lim);
      const cl = clipAll(raw, clip);
      if (!cl.length) continue;
      lines.push(...cl);
      // label at the summer end (last point of the declination sweep)
      const l = cl[cl.length - 1];
      const a = l[l.length - 1], b = l[l.length - 2];
      const dx = a[0] - b[0], dy = a[1] - b[1], n = Math.hypot(dx, dy) || 1;
      const q = clampIn([a[0] + (dx / n) * fs * 0.7, a[1] + (dy / n) * fs * 0.7]);
      labels.push({ x: q[0], y: q[1], text: String(k), cls, size: 0.7 });
    }
    add(id, cls, lines, labels);
  }
  if (o.xItalian) sunsetLines('italian', 'ital', true);
  if (o.xBabylonian) sunsetLines('babylonian', 'bab', false);

  // ---------- Azimuth & altitude lines (only where the sun can actually be) ----------
  const pole = poleAxis(lat);
  const reachable = (s) => {
    const d = Math.asin(dot(s, pole)) * RAD;
    return d >= dMin - 0.01 && d <= dMax + 0.01;
  };
  const sunDir = (A, alt) => [ // A: azimuth from south towards west
    -Math.sin(A * DEG) * Math.cos(alt * DEG), -Math.cos(A * DEG) * Math.cos(alt * DEG), Math.sin(alt * DEG)];
  if (o.xAzimuth) {
    const lines = [], labels = [];
    for (let A = -165; A <= 180; A += 15) {
      const cl = clipAll(trace(range(0.5, 89.5, 1), (alt) => {
        const s = sunDir(A, alt);
        return reachable(s) ? shadowPoint(s, L, fr) : null;
      }, lim), clip);
      if (!cl.length) continue;
      lines.push(...cl);
      const top = cl.flat().reduce((a, b) => (b[1] > a[1] ? b : a));
      const q = clampIn([top[0], top[1] + fs * 0.6]);
      labels.push({ x: q[0], y: q[1], text: ((A + 180) % 360) + '°', cls: 'az', size: 0.6 });
    }
    add('azimuth', 'az', lines, labels);
  }
  if (o.xAltitude) {
    const lines = [], labels = [];
    for (let alt = 10; alt <= 80; alt += 10) {
      const cl = clipAll(trace(range(-180, 180, 1), (A) => {
        const s = sunDir(A, alt);
        return reachable(s) ? shadowPoint(s, L, fr) : null;
      }, lim), clip);
      if (!cl.length) continue;
      lines.push(...cl);
      const p = labelAlong(cl, 0.5, fs * 0.45);
      if (p) labels.push({ x: p[0], y: p[1], text: alt + '°', cls: 'alt', size: 0.6 });
    }
    add('altitude', 'alt', lines, labels);
  }

  // ---------- Substyle ----------
  if (o.xSubstyle && root) {
    const n = Math.hypot(root[0], root[1]);
    if (n > 1e-6) {
      const d = [-root[0] / n, -root[1] / n];
      add('substyle', 'construct', clipPolyline([root, [root[0] + d[0] * lim, root[1] + d[1] * lim]], clip));
    }
  }

  placeLabels(layers.flatMap((l) => l.labels), clip, fs);

  // ---------- Warnings & stats ----------
  const warnings = [];
  const stats = sunStats(lat, D, cfg.horizon || []);
  if (Math.abs(lat) < 10) warnings.push(['nearEquator']);
  // these two only concern the triangular polar style
  if (o.gPolar && !root) warnings.push(['polarParallel']);
  else if (o.gPolar && Math.hypot(root[0], root[1]) > 4 * L) warnings.push(['rootFar', (Math.hypot(root[0], root[1]) / L).toFixed(1)]);
  if (Math.abs(Math.abs(D) - 90) < 12) warnings.push(['eastWest']);
  if (stats.litPerDay < 0.05) warnings.push(['noSun']);
  else if (stats.litPerDay < 3) warnings.push(['littleSun', stats.litPerDay.toFixed(1)]);
  const b = coreBBox(lat, D, cfg.grazing || 8, false);
  if (b.n && (b.x0 * L < clip.x0 - 1 || b.x1 * L > clip.x1 + 1 || b.y0 * L < clip.y0 - 1 || b.y1 * L > clip.y1 + 1)) warnings.push(['clipped']);
  if (root && (root[0] < clip.x0 - m || root[0] > clip.x1 + m || root[1] < clip.y0 - m || root[1] > clip.y1 + m) && o.gPolar) warnings.push(['rootOutside']);

  return { frame: fr, root, angles, layers, clip, warnings, stats, L, plate: P, fontSize: fs, bladeH: bladeHeight(L, o.bladeR ?? BLADE_RATIO), horizon: cfg.horizon || [] };
}
