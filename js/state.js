// Default settings, presets, input sanity bounds, and the glue that turns UI
// state into a computed dial. Shared by the page (app.js) and Node (build).

import { computeDial, autoFit, BLADE_RATIO, absoluteDeclination, wallLimit, L_MIN, L_MAX } from './dial.js';
import { DST_RULES, lonCorrection } from './astro.js';
import { sizesFor } from './svg.js';

export const PRESETS = {
  rome: { name: 'Roma', lat: 41.9028, lon: 12.4964, tz: 1, dst: 'EU' },
  milan: { name: 'Milano', lat: 45.4642, lon: 9.19, tz: 1, dst: 'EU' },
  turin: { name: 'Torino', lat: 45.0703, lon: 7.6869, tz: 1, dst: 'EU' },
  venice: { name: 'Venezia', lat: 45.4408, lon: 12.3155, tz: 1, dst: 'EU' },
  florence: { name: 'Firenze', lat: 43.7696, lon: 11.2558, tz: 1, dst: 'EU' },
  naples: { name: 'Napoli', lat: 40.8518, lon: 14.2681, tz: 1, dst: 'EU' },
  palermo: { name: 'Palermo', lat: 38.1157, lon: 13.3615, tz: 1, dst: 'EU' },
  cagliari: { name: 'Cagliari', lat: 39.2238, lon: 9.1217, tz: 1, dst: 'EU' },
  london: { name: 'London', lat: 51.5072, lon: -0.1276, tz: 0, dst: 'EU' },
  paris: { name: 'Paris', lat: 48.8566, lon: 2.3522, tz: 1, dst: 'EU' },
  berlin: { name: 'Berlin', lat: 52.52, lon: 13.405, tz: 1, dst: 'EU' },
  madrid: { name: 'Madrid', lat: 40.4168, lon: -3.7038, tz: 1, dst: 'EU' },
  newyork: { name: 'New York', lat: 40.7128, lon: -74.006, tz: -5, dst: 'US' },
  sydney: { name: 'Sydney', lat: -33.8688, lon: 151.2093, tz: 10, dst: 'AU' },
};

const WINDS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compass name of the direction a wall faces, for declination delta (from the equator side) at this latitude. */
export function wallDirectionName(lat, delta) {
  const az = (180 + absoluteDeclination(lat, delta) + 360) % 360; // compass azimuth the wall faces
  return WINDS[Math.round(az / 22.5) % 16];
}

/** Wall directions offered as presets at this latitude, by increasing declination: [{ key, D }]. */
export function wallPresetsFor(lat) {
  const lim = wallLimit(lat), out = [];
  for (let d = -157.5; d <= 180; d += 22.5) if (Math.abs(d) <= lim) out.push({ key: wallDirectionName(lat, d), D: d });
  return out;
}

export const DEFAULTS = {
  lang: 'en',
  place: 'rome', lat: 41.9028, lon: 12.4964, tz: 1, dst: 'EU',
  D: 45,
  plateW: 600, plateH: 450, auto: true, L: 80, fx: 300, fy: 100, includeRoot: true, grazing: 12,
  gPolar: true, gRod: true, gBlade: false,
  hSolar: true, hZone: false, hHalf: true, hQuarter: false, hRoman: false, hExtend: true, hDstLabels: false,
  anaMeanNoon: true, anaZoneNoon: false, anaHours: false, anaMonthTicks: true,
  dSolEq: true, dZodiac: false, dMonths: false,
  xItalian: false, xBabylonian: false, xAzimuth: false, xAltitude: false, xSubstyle: true, xInfo: true, motto: '',
  material: 'paper', paper: 'none', overlap: 10, orient: 'auto', printMargin: 8, ink: 'color',
  v2d: true, v3d: true,
};

// [min, max] sanity bounds for numeric settings
export const BOUNDS = {
  lat: [-66, 66], lon: [-180, 180], tz: [-12, 14], D: [-180, 180],
  plateW: [50, 5000], plateH: [50, 5000], L: [L_MIN, L_MAX], fx: [-10000, 10000], fy: [-10000, 10000],
  grazing: [1, 40], overlap: [0, 60], printMargin: [0, 30],
};

/** Coerce types, clamp to bounds. Returns { s, warnings }. */
export function sanitize(input) {
  const s = { ...DEFAULTS, ...input };
  const warnings = [];
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (typeof def === 'number') {
      let v = Number(s[k]);
      if (!Number.isFinite(v)) { v = def; warnings.push(['badInput']); }
      if (BOUNDS[k]) {
        const [a, b] = BOUNDS[k];
        if (v < a || v > b) {
          warnings.push([k === 'lat' ? 'latClamped' : 'badInput']);
          v = Math.min(b, Math.max(a, v));
        }
      }
      s[k] = v;
    } else if (typeof def === 'boolean') {
      s[k] = s[k] === true || s[k] === 'true' || s[k] === '1' || s[k] === 1;
    } else {
      s[k] = String(s[k] ?? def);
    }
  }
  // outside the tropics, walls facing away from the sun are not offered
  const lim = wallLimit(s.lat);
  if (Math.abs(s.D) > lim) { s.D = Math.sign(s.D) * lim; warnings.push(['wallClamped']); }
  if (!['paper', 'tile', 'laser'].includes(s.material)) s.material = 'paper';
  if (!['auto', 'portrait', 'landscape'].includes(s.orient)) s.orient = 'auto';
  if (!['color', 'bw'].includes(s.ink)) s.ink = 'color';
  if (!['none', 'A4', 'A3', 'A2'].includes(s.paper)) s.paper = 'none';
  if (!DST_RULES.includes(s.dst)) s.dst = 'none';
  if (!Object.hasOwn(PRESETS, s.place)) s.place = 'custom';
  if (!['en', 'it'].includes(s.lang)) s.lang = 'en';
  s.motto = s.motto.slice(0, 80);
  // a dial needs at least one way of telling the time
  if (!s.gPolar && !s.gRod && !s.gBlade) s.gRod = true;
  // dedupe identical warnings
  const seen = new Set();
  return { s, warnings: warnings.filter((w) => !seen.has(w[0]) && seen.add(w[0])) };
}

const r2 = (x, q) => Math.round(x / q) * q;

/**
 * Summer time is a clock concept, so the "+1 h" labels only go on lines that read
 * clock time: the zone-time hour lines and the zone-time figure-8s. On the
 * solar-time lines (and the local-mean-noon figure-8) they would be meaningless.
 */
export const dstLabelsApply = (s) => !!(s.hZone || s.anaZoneNoon || s.anaHours);

/** URL-hash form of the state: only values that differ from the defaults. */
export function serializeState(s) {
  const p = new URLSearchParams();
  for (const [k, def] of Object.entries(DEFAULTS)) if (s[k] !== def) p.set(k, String(s[k]));
  return p.toString();
}

/** Build the dial from sanitized state. Rounds L / foot to buildable values. */
export function buildDial(s, t) {
  const D = absoluteDeclination(s.lat, s.D); // s.D is measured from the equator-facing side; the maths wants D from south
  const plate = { w: s.plateW, h: s.plateH, margin: Math.max(4, Math.min(s.plateW, s.plateH) * 0.02) };
  const { fs } = sizesFor(s.material, plate);
  const bottomReserve = s.xInfo || s.motto ? fs * 1.4 : 0;
  let { L, fx, fy } = s;
  let fit = null;
  if (s.auto) {
    // extra room around the shadow region for the hour labels
    fit = autoFit(s.lat, D, { ...plate, margin: plate.margin + fs * 1.6 }, s.grazing, s.includeRoot && s.gPolar, bottomReserve,
      s.includeRoot && s.gBlade ? BLADE_RATIO : 0);
    L = r2(fit.L, 1); fx = r2(fit.fx, 0.5); fy = r2(fit.fy, 0.5);
  }
  const dial = computeDial({
    lat: s.lat, lon: s.lon, tz: s.tz, D, L,
    plate: { ...plate, fx, fy }, fontSize: fs, opts: s, t, grazing: s.grazing, bottomReserve,
  });
  // things the user should know about the automatic fit, and about a time zone that does not fit the place
  if (fit?.relaxedTo != null) dial.warnings.push(['fitRelaxed', s.grazing, fit.relaxedTo]);
  if (fit?.clamped && !fit.empty) dial.warnings.push(['fitClamped', L]);
  const off = Math.abs(lonCorrection(s.lon, s.tz)) / 60; // hours between the place and the middle of its time zone
  if (off > 190 / 60) dial.warnings.push(['zoneFar', off.toFixed(1)]); // a few places (far west of China) reach 3.1 h; more is probably a wrong zone
  return dial;
}
