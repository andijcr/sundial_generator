// Dial geometry: wall frame, shadow projection, and generation of every mark.
// Pure functions, no DOM.
//
// Coordinates on the dial ("dial coords"): millimetres, origin at the gnomon
// foot F (the point of the wall right behind the nodus), x to the right as you
// face the wall, y up. The nodus N sits at distance L in front of F.

import { sunVector, solarParams, sunsetHourAngle, dayMs, DEG, RAD, norm180 } from './astro.js';

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

/** Hours of sun on the wall, averaged per day over the year, and daylight hours. */
export function sunStats(lat, D) {
  const fr = wallFrame(D);
  const Y = yearTable();
  let lit = 0, day = 0, days = 0;
  for (let i = 0; i < Y.length; i += 5) {
    days++;
    for (let H = -180; H < 180; H += 2.5) {
      const s = sunVector(Y[i].decl, H, lat);
      if (s[2] > 0) { day++; if (dot(s, fr.n) > 0) lit++; }
    }
  }
  const k = 10 / 60 / days; // 2.5° = 10 minutes
  return { litPerDay: lit * k, dayPerDay: day * k };
}

/** Box of a label (dial coords, mm): [x0, x1, y0, y1]. Text is centred on (x, y); the width is estimated (0.6 em per character). */
export function labelBox(lb, fs, x = lb.x, y = lb.y) {
  const z = fs * (lb.size || 1), w = [...lb.text].length * 0.6 * z + 0.15 * z, h = 0.85 * z;
  return [x - w / 2, x + w / 2, y - h / 2, y + h / 2];
}
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
    const d = lb.of && moved.get(lb.of);
    const x0 = lb.x + (d ? d[0] : 0), y0 = lb.y + (d ? d[1] : 0);
    const z = fs * (lb.size || 1);
    const free = (x, y) => { const b = labelBox(lb, fs, x, y); return !placed.some((p) => boxesHit(b, p)); };
    const inside = (x, y) => { const b = labelBox(lb, fs, x, y); return b[0] >= clip.x0 && b[1] <= clip.x1 && b[2] >= clip.y0 && b[3] <= clip.y1; };
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
    placed.push(labelBox(lb, fs));
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
  function hourSet(id, shift, cls, dstLabels) {
    const step = o.hQuarter ? 0.25 : o.hHalf ? 0.5 : 1;
    const major = [], minor = [], ext = [], labels = [];
    for (let h = 0; h < 24 - 1e-9; h += step) {
      const H = 15 * (h - 12) + shift;
      const raw = trace(declRange, (d) => SP(d, H), lim);
      if (!raw.length) continue;
      const isMajor = Math.abs(h - Math.round(h)) < 1e-6;
      const clipped = clipAll(raw, clip);
      (isMajor ? major : minor).push(...clipped);
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
    add(id + 'Minor', cls + 'Minor', minor);
    add(id, cls, major, labels);
  }
  if (o.hSolar) hourSet('hourSolar', 0, 'hour', false);
  if (o.hZone) hourSet('hourZone', zoneShift, 'zone', o.hDstLabels);

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
  if (o.dMonths) {
    const Y = yearTable();
    const list = Y.filter((d) => d.dom === 1).map((d) => [d.decl, '1 ' + months[d.m], d.m < 6 ? 0.55 : 0.4]);
    addCurves('dateMonths', 'dateMinor', list);
  }

  // ---------- Analemmas ----------
  function analemma(H0, hourLabel, monthLabels, dstLabel) {
    const Y = yearTable();
    const pts = Y.map((d) => SP(d.decl, H0 + 0.25 * d.eot));
    const rising = [], falling = [];
    let cur = null, curRising = null;
    for (let i = 0; i < Y.length; i++) {
      const j = (i + 1) % Y.length;
      const a = pts[i], b = pts[j];
      if (!a || !b || Math.abs(a[0]) > lim || Math.abs(b[0]) > lim || Math.abs(a[1]) > lim || Math.abs(b[1]) > lim) {
        if (cur) (curRising ? rising : falling).push(cur);
        cur = null; continue;
      }
      const r = Y[j].decl > Y[i].decl;
      if (!cur || r !== curRising) {
        if (cur) (curRising ? rising : falling).push(cur);
        cur = [a]; curRising = r;
      }
      cur.push(b);
    }
    if (cur) (curRising ? rising : falling).push(cur);
    const valid = pts.filter(Boolean);
    if (!valid.length) return;
    const cx = valid.reduce((s, p) => s + p[0], 0) / valid.length;
    const cy = valid.reduce((s, p) => s + p[1], 0) / valid.length;
    const ticks = [], labels = [];
    if (o.anaMonthTicks) {
      for (let i = 0; i < Y.length; i++) {
        if (Y[i].dom !== 1 || !pts[i]) continue;
        const a = pts[(i + Y.length - 1) % Y.length], b = pts[(i + 1) % Y.length];
        if (!a || !b) continue;
        const tx = b[0] - a[0], ty = b[1] - a[1], tn = Math.hypot(tx, ty) || 1;
        let nx = -ty / tn, ny = tx / tn;
        const p = pts[i];
        if ((p[0] - cx) * nx + (p[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
        const tl = fs * 0.5;
        ticks.push([p, [p[0] + nx * tl, p[1] + ny * tl]]);
        if (monthLabels) {
          const q = [p[0] + nx * (tl + fs * 0.7), p[1] + ny * (tl + fs * 0.7)];
          if (q[0] > clip.x0 && q[0] < clip.x1 && q[1] > clip.y0 && q[1] < clip.y1) labels.push({ x: q[0], y: q[1], text: months[Y[i].m], cls: 'ana', size: 0.6 });
        }
      }
    }
    if (hourLabel) {
      // put the hour number beyond the summer (longest shadow) end of the 8
      let k = 0;
      Y.forEach((d, i) => { if (pts[i] && d.decl > Y[k].decl) k = i; });
      if (pts[k]) {
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
    add('anaR', 'anaR', clipAll(rising, clip));
    add('anaF', 'anaF', clipAll(falling, clip), labels);
    add('anaTicks', 'tick', clipAll(ticks, clip));
  }
  const noonCount = (o.anaMeanNoon ? 1 : 0) + (o.anaZoneNoon || o.anaHours ? 1 : 0);
  if (o.anaMeanNoon) analemma(0, noonCount > 1 ? t('meanNoonShort') : null, true, null);
  if (o.anaHours) {
    for (let h = 0; h < 24; h++) {
      const H0 = 15 * (h - 12) + zoneShift;
      analemma(H0, hourText(h), h === 12, o.hDstLabels ? hourText(h + 1) : null);
    }
  } else if (o.anaZoneNoon) {
    analemma(zoneShift, hourText(12), true, o.hDstLabels ? hourText(13) : null);
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
  const stats = sunStats(lat, D);
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

  return { frame: fr, root, angles, layers, clip, warnings, stats, L, plate: P, fontSize: fs, bladeH: bladeHeight(L, o.bladeR ?? BLADE_RATIO) };
}
