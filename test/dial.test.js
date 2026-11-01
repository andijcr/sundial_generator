import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunVector, DEG } from '../js/astro.js';
import { wallFrame, shadowPoint, styleRoot, dialAngles, dot, poleAxis, autoFit, clipPolyline, sunStats } from '../js/dial.js';
import { DEFAULTS, sanitize, buildDial } from '../js/state.js';
import { faceSheet, faceSheetSize, gnomonSheet, infoSheet, svgDoc, tileSheets, tileLayout } from '../js/svg.js';
import { fmtHM } from '../js/astro.js';
import { makeT } from '../js/i18n.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const sin = (d) => Math.sin(d * DEG), cos = (d) => Math.cos(d * DEG), tan = (d) => Math.tan(d * DEG);

test('wall frame is orthonormal and right-handed as seen from outside', () => {
  for (const D of [-120, -45, 0, 30, 45, 90, 180]) {
    const { n, u, v } = wallFrame(D);
    for (const a of [n, u, v]) near(Math.hypot(...a), 1, 1e-12);
    near(dot(n, u), 0, 1e-12); near(dot(n, v), 0, 1e-12); near(dot(u, v), 0, 1e-12);
  }
  // south wall: right is east
  assert.deepEqual(wallFrame(0).u.map((x) => Math.round(x) + 0), [1, 0, 0]);
});

test('vector method reproduces the classical dialling formulas', () => {
  for (const lat of [30, 41.9028, 52]) {
    for (const D of [-60, -20, 0, 20, 45, 70]) {
      const a = dialAngles(lat, D);
      near(sin(a.SH), cos(lat) * cos(D), 1e-9, `SH lat=${lat} D=${D}`);
      near(Math.abs(tan(a.SD)), Math.abs(sin(D) / tan(lat)), 1e-9, `SD lat=${lat} D=${D}`);
      near(tan(a.DL), tan(D) / sin(lat), 1e-9, `DL lat=${lat} D=${D}`);
    }
  }
  const r = dialAngles(41.9028, 45);
  near(r.SH, 31.75, 0.01); near(Math.abs(r.SD), 38.24, 0.01); near(r.DL, 56.26, 0.01);
});

test('shadow point lies on the line from the sun through the nodus', () => {
  const fr = wallFrame(45), L = 100;
  for (const [d, H] of [[0, 30], [20, 45], [-20, 10]]) {
    const s = sunVector(d, H, 41.9);
    const p = shadowPoint(s, L, fr);
    assert.ok(p, 'sun on wall');
    const P = [0, 1, 2].map((i) => p[0] * fr.u[i] + p[1] * fr.v[i]);
    const N = fr.n.map((x) => x * L);
    const d1 = N.map((x, i) => x - P[i]);
    const nn = Math.hypot(...d1);
    for (let i = 0; i < 3; i++) near(d1[i] / nn, s[i], 1e-9, 'direction to the sun');
  }
  assert.equal(shadowPoint(sunVector(0, -60, 41.9), L, fr), null, 'morning sun is behind a SW wall');
});

test('hour lines are straight and pass through the style root', () => {
  const lat = 41.9, fr = wallFrame(45), L = 100;
  const R = styleRoot(lat, L, fr);
  for (const H of [0, 15, 30, 45, 60]) {
    const a = shadowPoint(sunVector(-20, H, lat), L, fr);
    const b = shadowPoint(sunVector(20, H, lat), L, fr);
    const cross = (a[0] - R[0]) * (b[1] - R[1]) - (a[1] - R[1]) * (b[0] - R[0]);
    near(cross / (Math.hypot(a[0] - R[0], a[1] - R[1]) * Math.hypot(b[0] - R[0], b[1] - R[1])), 0, 1e-9, `H=${H}`);
  }
});

test('south wall: solar noon line is the vertical through the foot', () => {
  const fr = wallFrame(0);
  for (const d of [-20, 0, 20]) near(shadowPoint(sunVector(d, 0, 45), 100, fr)[0], 0, 1e-9);
  const R = styleRoot(45, 100, fr);
  near(R[0], 0, 1e-9);
  assert.ok(R[1] > 0, 'root above the foot');
});

test('style root lies on the polar axis through the nodus', () => {
  const lat = 41.9, fr = wallFrame(45), L = 80;
  const R = styleRoot(lat, L, fr);
  const P = [0, 1, 2].map((i) => R[0] * fr.u[i] + R[1] * fr.v[i]);
  const N = fr.n.map((x) => x * L);
  const d = N.map((x, i) => x - P[i]);
  const nn = Math.hypot(...d);
  const p = poleAxis(lat);
  near(Math.abs(dot(d, p)) / nn, 1, 1e-9);
  assert.equal(styleRoot(lat, L, wallFrame(90)), null, 'east/west wall: axis parallel to wall');
});

test('equinox line is straight', () => {
  const fr = wallFrame(30), pts = [];
  for (let H = -20; H <= 80; H += 10) pts.push(shadowPoint(sunVector(0, H, 41.9), 100, fr));
  const [a, b] = [pts[0], pts[pts.length - 1]];
  for (const p of pts) {
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    near(cross / Math.hypot(b[0] - a[0], b[1] - a[1]), 0, 1e-6);
  }
});

test('clipPolyline keeps segments inside the box', () => {
  const r = { x0: 0, x1: 10, y0: 0, y1: 10 };
  const out = clipPolyline([[-5, 5], [5, 5], [15, 5], [15, 15], [5, 8], [5, 2]], r);
  for (const l of out) for (const [x, y] of l) assert.ok(x >= -1e-9 && x <= 10 + 1e-9 && y >= -1e-9 && y <= 10 + 1e-9);
  assert.equal(out.length, 2);
});

test('auto-fit puts the foot inside the plate with a usable L', () => {
  const plate = { w: 600, h: 450, margin: 10 };
  const f = autoFit(41.9028, 45, plate, 12, true);
  assert.ok(f.L > 30 && f.L < 300, `L=${f.L}`);
  assert.ok(f.fx > 0 && f.fx < plate.w && f.fy > 0 && f.fy < plate.h);
});

test('sun statistics: south wall gets more sun than north wall', () => {
  const s = sunStats(41.9, 0), n = sunStats(41.9, 180);
  assert.ok(s.litPerDay > 8 && n.litPerDay < 3, `${s.litPerDay} ${n.litPerDay}`);
  const syd = sunStats(-33.87, 180);
  assert.ok(syd.litPerDay > 8, 'north wall in Sydney is the sunny one');
});

test('sanitize clamps and coerces', () => {
  const { s, warnings } = sanitize({ lat: '89', D: '45', auto: 'false', plateW: 'abc' });
  assert.equal(s.lat, 66);
  assert.equal(s.D, 45);
  assert.equal(s.auto, false);
  assert.equal(s.plateW, DEFAULTS.plateW);
  assert.ok(warnings.some((w) => w[0] === 'latClamped'));
});

test('sheets render for many configurations without NaN', () => {
  const configs = [
    {}, { lang: 'it', hZone: true, anaHours: true, hDstLabels: true, xItalian: true, xBabylonian: true, xAzimuth: true, xAltitude: true, dZodiac: true, dMonths: true },
    { D: 90 }, { D: -90 }, { D: 180 }, { D: 0, lat: 5 }, { lat: -33.87, lon: 151.2, tz: 10, dst: 'AU', D: 180 },
    { material: 'laser', hRoman: true, motto: 'Ultima <latet> & "test"' }, { material: 'tile', auto: false, L: 120, fx: 300, fy: 50 },
  ];
  for (const c of configs) {
    const { s } = sanitize({ ...DEFAULTS, ...c });
    const t = makeT(s.lang);
    const dial = buildDial(s, t);
    const ctx = { s, t, place: 'Test', dateStr: '2026-01-01' };
    for (const sh of [faceSheet(dial, ctx), gnomonSheet(dial, ctx), infoSheet(dial, ctx)]) {
      const svg = svgDoc(sh);
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `bad number in ${sh.name} for ${JSON.stringify(c)}`);
      assert.ok(svg.includes('mm" height="'), 'real-world units');
      assert.ok(!svg.includes('<latet>'), 'text is escaped');
    }
  }
});

test('tiling covers the sheet', () => {
  const { s } = sanitize({ ...DEFAULTS, plateW: 1000, plateH: 700 });
  const t = makeT('en');
  const dial = buildDial(s, t);
  const sheet = faceSheet(dial, { s, t });
  const tiles = tileSheets(sheet, 'A4', 10, 'x');
  assert.ok(tiles.length >= 6, `got ${tiles.length}`);
  assert.equal(tileSheets(sheet, 'none', 10, 'x').length, 0);
});

test('sanitize rejects unknown places (no markup from the URL hash)', () => {
  for (const place of ['</title><img src=x onerror=alert(1)>', 'toString', '__proto__']) {
    assert.equal(sanitize({ place }).s.place, 'custom');
  }
  assert.equal(sanitize({ place: 'milan' }).s.place, 'milan');
});

test('tile layout matches the rendered tiles; face size matches the sheet', () => {
  const { s } = sanitize({ ...DEFAULTS, plateW: 1000, plateH: 700 });
  const t = makeT('en');
  const dial = buildDial(s, t);
  const sheet = faceSheet(dial, { s, t });
  const size = faceSheetSize(dial);
  assert.deepEqual([size.W, size.H], [sheet.W, sheet.H]);
  for (const paper of ['A4', 'A3', 'A2']) {
    const lay = tileLayout(size.W, size.H, paper, 10);
    assert.equal(lay.nx * lay.ny, tileSheets(sheet, paper, 10, 'x').length, paper);
  }
});

test('fmtHM rounds across the hour', () => {
  assert.equal(fmtHM(13.9995 * 60), '14:00');
  assert.equal(fmtHM(-1), '23:59');
});

test('Roman numerals also apply to the zone-noon figure-8', () => {
  const { s } = sanitize({ ...DEFAULTS, hRoman: true, anaZoneNoon: true, hDstLabels: true });
  const dial = buildDial(s, makeT('en'));
  const texts = dial.layers.filter((l) => l.cls === 'anaF').flatMap((l) => l.labels.map((x) => x.text));
  assert.ok(texts.includes('XII') && texts.includes('XIII') && !texts.includes('12'), texts.join(','));
});
