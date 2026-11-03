import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunVector, DEG } from '../js/astro.js';
import { wallFrame, shadowPoint, styleRoot, dialAngles, dot, poleAxis, autoFit, clipPolyline, sunStats, bladeHeight, BLADE_RATIO, absoluteDeclination, relativeDeclination, wallLimit, TROPIC_LAT } from '../js/dial.js';
import { DEFAULTS, sanitize, buildDial, fitPlateToPage, fitGnomonToPage, ROD_SCALES, serializeState, dstLabelsApply, wallPresetsFor, wallDirectionName } from '../js/state.js';
import { faceSheet, faceSheetSize, gnomonSheet, infoSheet, svgDoc, tileSheets, tileLayout, tileSavings, frontViewSvg, shadowMarkup, correctionGraph, correctionMarker, correctionSheet, graphCss, fmtMin } from '../js/svg.js';
import { fmtHM, yearCorrections, lonCorrection, utcMs, correctionAt } from '../js/astro.js';
import { printJobHtml, printJobPages, MAX_QUIET_PAGES } from '../js/svg.js';
import { L_MIN, L_MAX } from '../js/dial.js';
import { makeT, STRINGS } from '../js/i18n.js';

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
    { D: 90 }, { D: -90 }, { D: 180 }, { D: 180, lat: 5 }, { D: -135, lat: -10 }, { D: 0, lat: 5 },
    { lat: -33.87, lon: 151.2, tz: 10, dst: 'AU', D: 45 }, { lat: -33.87, lon: 151.2, tz: 10, dst: 'AU', D: -90 }, { lat: -60, D: 0 },
    { material: 'laser', hRoman: true, motto: 'Ultima <latet> & "test"' }, { material: 'tile', auto: false, L: 120, fx: 300, fy: 50 },
    { faceBrief: true }, { faceBrief: true, lang: 'it', gPolar: false, plateW: 100, plateH: 80 }, { rodX: 2 }, { rodX: 5, lang: 'it', gBlade: true }, { rodX: 3, gPolar: false, plateW: 200, plateH: 150 },
    { gBlade: true }, { gBlade: true, bladeR: 0.3, plateW: 100, plateH: 80 }, { gBlade: true, bladeR: 3, lang: 'it' }, { gPolar: false, gRod: false, gBlade: true }, { gPolar: false, gRod: false, gBlade: true, D: 90, plateW: 200, plateH: 150 },
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

test('vertical blade: its shadow is the planar triangle F, S, A (projected along the sun)', () => {
  const fr = wallFrame(45), L = 100, h = bladeHeight(L);
  // project a 3D point onto the wall plane along the sun direction, return wall coords
  const project = (P, s) => {
    const k = dot(P, fr.n) / dot(s, fr.n);
    const X = P.map((c, i) => c - k * s[i]);
    return [dot(X, fr.u), dot(X, fr.v)];
  };
  for (const [d, H] of [[0, 30], [20, 50], [-20, 10], [10, 70]]) {
    const s = sunVector(d, H, 41.9);
    const S = shadowPoint(s, L, fr);
    assert.ok(S, 'sun on the wall');
    const N = fr.n.map((x) => x * L), A = fr.v.map((x) => x * h);
    const pn = project(N, s), pa = project(A, s), pf = project([0, 0, 0], s);
    near(pn[0], S[0], 1e-9); near(pn[1], S[1], 1e-9); // the tip's shadow is the dial's reading point
    near(pa[0], 0, 1e-9); near(pa[1], h, 1e-9); // a point on the wall casts its shadow on itself
    near(pf[0], 0, 1e-9); near(pf[1], 0, 1e-9);
  }
});

test('blade-only is a valid configuration; with nothing selected the rod is restored', () => {
  const blade = sanitize({ gPolar: false, gRod: false, gBlade: true }).s;
  assert.deepEqual([blade.gPolar, blade.gRod, blade.gBlade], [false, false, true]);
  const none = sanitize({ gPolar: false, gRod: false, gBlade: false }).s;
  assert.deepEqual([none.gPolar, none.gRod, none.gBlade], [false, true, false]);
  assert.equal(sanitize({}).s.gBlade, false, 'off by default');
});

test('auto-fit keeps the blade on the plate when asked', () => {
  const plate = { w: 600, h: 450, margin: 10 };
  const a = autoFit(41.9028, 45, plate, 12, false, 0, 0);
  const b = autoFit(41.9028, 45, plate, 12, false, 0, BLADE_RATIO);
  assert.ok(b.fy - b.L * BLADE_RATIO >= plate.margin - 1e-6, 'blade top inside the plate');
  assert.ok(b.L <= a.L + 1e-9, 'reserving room above F cannot make the dial bigger');
});

test('warnings about the triangular style only appear when it is selected', () => {
  const warn = (c) => buildDial(sanitize({ ...DEFAULTS, ...c }).s, makeT('en')).warnings.map((w) => w[0]);
  assert.ok(warn({ D: 90, gPolar: true }).includes('polarParallel'));
  const off = warn({ D: 90, gPolar: false, gRod: false, gBlade: true });
  assert.ok(!off.includes('polarParallel') && !off.includes('rootFar'), off.join(','));
});

test('blade template appears on the gnomon sheet, in both languages', () => {
  for (const lang of ['en', 'it']) {
    const { s } = sanitize({ ...DEFAULTS, lang, gPolar: false, gRod: false, gBlade: true });
    const t = makeT(lang);
    const dial = buildDial(s, t);
    const svg = svgDoc(gnomonSheet(dial, { s, t, place: 'x', dateStr: 'x' }));
    assert.ok(svg.includes(t('bladeBrace')) && svg.includes(`h = ${bladeHeight(dial.L).toFixed(1)} mm`), lang);
    assert.ok(!svg.includes(t('styleEdge')) && !svg.includes(t('rodNote')), 'only the blade is drawn');
  }
});

test('hour lines extend to the style root only for the triangular style', () => {
  const ext = (c) => buildDial(sanitize({ ...DEFAULTS, ...c }).s, makeT('en')).layers.find((l) => l.id === 'hourSolarExt').lines.length;
  assert.ok(ext({ gPolar: true }) > 0);
  assert.equal(ext({ gPolar: false, gRod: false, gBlade: true }), 0);
});

// ---- blade: tests that go through the real drawing code ----

const bladeCfg = (c = {}) => {
  const { s } = sanitize({ ...DEFAULTS, gPolar: false, gRod: false, gBlade: true, ...c });
  const t = makeT(s.lang);
  return { s, t, dial: buildDial(s, t) };
};
const pts = (svg, re) => [...svg.matchAll(re)].map((m) => m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number)));

test('shadowMarkup draws the blade shadow as the triangle A (h above F), F, S', () => {
  const { s, dial } = bladeCfg();
  const S = shadowPoint(sunVector(0, 40, 41.9028), dial.L, dial.frame);
  assert.ok(S, 'sun on the wall');
  const [tri] = pts(shadowMarkup(dial, { s }, S), /<polygon points="([^"]+)"/g);
  const P = dial.plate;
  const want = [[P.fx, P.fy - bladeHeight(dial.L)], [P.fx, P.fy], [P.fx + S[0], P.fy - S[1]]];
  assert.equal(tri.length, 3);
  tri.forEach(([x, y], i) => { near(x, want[i][0], 0.01, `vertex ${i} x`); near(y, want[i][1], 0.01, `vertex ${i} y`); });
});

test('front view: blade is a vertical bar from F; rod and blade share one dot', () => {
  const { s, dial } = bladeCfg();
  const svg = frontViewSvg(dial, { s, t: makeT('en') });
  const P = dial.plate;
  const bar = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#2b2b2b"/);
  assert.ok(bar, 'bar present');
  near(+bar[1], P.fx, 0.01); near(+bar[3], P.fx, 0.01);
  near(+bar[2], P.fy, 0.01); near(+bar[4], P.fy - bladeHeight(dial.L), 0.01);
  const both = frontViewSvg(dial, { s: { ...s, gRod: true }, t: makeT('en') });
  const dots = (x) => (x.match(/<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill="#2b2b2b"\/>/g) || []).length;
  assert.equal(dots(svg), 1);
  assert.equal(dots(both), 1, 'not drawn twice');
});

test('blade template: tab label only where it fits, otherwise it moves to the caption', () => {
  const sheet = (lang, L) => {
    const { s, t, dial } = bladeCfg({ lang, auto: false, L, fx: 300, fy: 120 });
    return { svg: svgDoc(gnomonSheet(dial, { s, t, place: 'x', dateStr: 'x' })), t };
  };
  const roomy = sheet('en', 80);
  assert.ok(roomy.svg.includes(`>${roomy.t('tab')}</text>`) && !roomy.svg.includes(roomy.t('bladeTabAt')), 'L=80 EN: label on the tab');
  const tight = sheet('it', 50);
  assert.ok(!tight.svg.includes(`>${tight.t('tab')}</text>`) && tight.svg.includes(tight.t('bladeTabAt')), 'L=50 IT: caption instead');
  const tiny = sheet('en', 20);
  assert.ok(tiny.svg.includes(tiny.t('bladeTabAt')));
  assert.match(tiny.svg, /<text class="dt"[^>]*style="text-anchor:end">h = 20\.0 mm<\/text>/, 'short h dimension: label on the outer (left) side');
});

test('blade stays clear of the "no triangular style" text', () => {
  const { s, t, dial } = bladeCfg({ gPolar: true, D: 90 });
  assert.equal(dial.root, null);
  const svg = svgDoc(gnomonSheet(dial, { s, t, place: 'x', dateStr: 'x' }));
  const [blade] = pts(svg, /<polygon class="cut" points="([^"]+)"/g);
  assert.ok(Math.min(...blade.map((p) => p[0])) > 25 + 100, 'blade starts to the right of the wrapped text');
  assert.ok(svg.includes(t('noPolar').split(' ')[0]));
});

test('gBlade survives the URL-hash round trip; includeRoot=false skips the blade headroom', () => {
  const { s } = bladeCfg();
  const back = sanitize(Object.fromEntries(new URLSearchParams(serializeState(s)))).s;
  assert.deepEqual([back.gPolar, back.gRod, back.gBlade], [false, false, true]);
  const L = (c) => bladeCfg({ includeRoot: false, ...c }).dial.L;
  assert.equal(L({}), L({ gBlade: false, gRod: true }), 'no headroom reserved when includeRoot is off');
});

test('English and Italian have exactly the same string keys', () => {
  const en = Object.keys(STRINGS.en).sort(), it = Object.keys(STRINGS.it).sort();
  assert.deepEqual(en.filter((k) => !it.includes(k)), [], 'missing in Italian');
  assert.deepEqual(it.filter((k) => !en.includes(k)), [], 'missing in English');
});

test('summer-time labels: the control is enabled exactly when the dial can draw them', () => {
  const dstLabelCount = (c) => buildDial(sanitize({ ...DEFAULTS, hDstLabels: true, ...c }).s, makeT('en'))
    .layers.flatMap((l) => l.labels).filter((l) => l.cls === 'dst').length;
  for (const hSolar of [true, false]) for (const hZone of [true, false]) for (const anaMeanNoon of [true, false])
    for (const anaZoneNoon of [true, false]) for (const anaHours of [true, false]) {
      const c = { hSolar, hZone, anaMeanNoon, anaZoneNoon, anaHours };
      const { s } = sanitize({ ...DEFAULTS, hDstLabels: true, ...c });
      assert.equal(dstLabelCount(c) > 0, dstLabelsApply(s), JSON.stringify(c));
    }
  assert.equal(dstLabelsApply(DEFAULTS), false, 'default dial has solar lines only');
});

// ---- wall direction: declination from the equator-facing side, limited outside the tropics ----

const sameAngle = (a, b) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180) < 1e-6; // equal modulo 360

test('declination from the equator side maps to declination from south, and back', () => {
  assert.equal(absoluteDeclination(41.9, 45), 45, 'north: unchanged (SW stays SW)');
  assert.equal(absoluteDeclination(-33.9, 45), 135, 'south: 45° west of north is the north-west wall');
  assert.equal(absoluteDeclination(-33.9, -45), -135, 'north-east');
  assert.equal(absoluteDeclination(-33.9, 180), 0, 'the pole-facing wall in the south faces south');
  assert.ok(sameAngle(absoluteDeclination(-33.9, 0), 180), 'equator-facing in the south faces north');
  for (const lat of [-60, -10, 5, 40]) for (let d = -180; d <= 180; d += 15) {
    assert.ok(sameAngle(relativeDeclination(lat, absoluteDeclination(lat, d)), d), `round trip lat ${lat} D ${d}`);
  }
});

test('the dial of a southern wall mirrors the northern one with the same declination', () => {
  for (const lat of [10, 25, 34, 42, 55, 65]) for (let d = -90; d <= 90; d += 15) {
    const N = dialAngles(lat, absoluteDeclination(lat, d)), S = dialAngles(-lat, absoluteDeclination(-lat, d));
    near(N.SH, S.SH, 1e-9, `style height lat ${lat} Δ ${d}`);
    near(Math.abs(N.SD), Math.abs(S.SD), 1e-9, `substyle lat ${lat} Δ ${d}`);
    near(sunStats(lat, absoluteDeclination(lat, d)).litPerDay, sunStats(-lat, absoluteDeclination(-lat, d)).litPerDay, 0.5, `sun hours lat ${lat} Δ ${d}`);
  }
});

test('walls facing away from the sun are only offered inside the tropics', () => {
  assert.equal(wallLimit(41.9), 90);
  assert.equal(wallLimit(-33.9), 90);
  assert.equal(wallLimit(TROPIC_LAT + 0.01), 90);
  assert.equal(wallLimit(TROPIC_LAT - 0.01), 180);
  assert.equal(wallLimit(-10), 180);
  assert.equal(wallLimit(0), 180);
  // the numbers behind the rule: a pole-facing wall is poor outside the tropics, fine inside
  assert.ok(sunStats(41.9, 180).litPerDay < 3 && sunStats(10, 180).litPerDay > 4.5);
});

test('sanitize clamps the wall direction outside the tropics and keeps it inside', () => {
  const w = (c) => sanitize({ ...DEFAULTS, ...c });
  let r = w({ lat: 41.9, D: 180 });
  assert.equal(r.s.D, 90); assert.ok(r.warnings.some(([k]) => k === 'wallClamped'));
  r = w({ lat: -33.9, D: -120 });
  assert.equal(r.s.D, -90); assert.ok(r.warnings.some(([k]) => k === 'wallClamped'));
  r = w({ lat: 10, D: 180 });
  assert.equal(r.s.D, 180); assert.ok(!r.warnings.some(([k]) => k === 'wallClamped'));
  r = w({ lat: -33.9, D: 45 });
  assert.equal(r.s.D, 45); assert.ok(!r.warnings.some(([k]) => k === 'wallClamped'));
  assert.equal(w({ lat: 10, D: 180 }).s.D, 180);
  assert.equal(w({ lat: 41.9, D: 180 }).s.D, 90, 'moving a pole-facing tropical wall to mid-latitudes pulls it back in range');
});

test('wall presets: offered by latitude, named by the direction the wall really faces', () => {
  const names = (lat) => wallPresetsFor(lat).map((p) => p.key);
  assert.deepEqual(names(41.9), ['E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W']);
  assert.deepEqual(names(-33.9), ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W']);
  assert.equal(names(10).length, 16, 'every direction inside the tropics');
  assert.equal(new Set(names(10)).size, 16, 'no duplicates');
  assert.equal(wallDirectionName(41.9, 45), 'SW');
  assert.equal(wallDirectionName(-33.9, 45), 'NW');
  assert.equal(wallDirectionName(-33.9, 0), 'N');
  assert.equal(wallDirectionName(41.9, 180), 'N');
  for (const lat of [41.9, -33.9, 10]) for (const p of wallPresetsFor(lat)) assert.ok(Math.abs(p.D) <= wallLimit(lat));
  for (const k of ['NNW', 'NNE', 'ENE', 'WNW']) for (const lang of ['en', 'it']) assert.ok(makeT(lang)('dirs')[k], `${lang} name for ${k}`);
});

test('buildDial uses the declination from south: a Sydney NW wall equals the 135° wall', () => {
  const t = makeT('en');
  const sydney = buildDial(sanitize({ ...DEFAULTS, lat: -33.8688, lon: 151.2093, tz: 10, dst: 'AU', D: 45 }).s, t);
  const a = dialAngles(-33.8688, 135);
  near(sydney.angles.SH, a.SH, 1e-9); near(sydney.angles.SD, a.SD, 1e-9); near(sydney.angles.DL, a.DL, 1e-9);
  assert.ok(sydney.stats.litPerDay > 7, `a north-west wall in Sydney is a sunny wall (${sydney.stats.litPerDay.toFixed(1)} h/day)`);
});

// ---- printing on A4 / A3: orientation, margin, black and white ----

const PAPER_SIDES = { A4: [210, 297], A3: [297, 420] };
const need = (len, avail, ov) => (len <= avail ? 1 : Math.ceil((len - ov) / (avail - ov)));

test('tileLayout: automatic orientation needs the fewest pages; a forced one is honoured', () => {
  for (const paper of ['A4', 'A3']) for (const [W, H] of [[670, 546], [400, 300], [1070, 796], [180, 260], [250, 190], [190, 243], [300, 800]]) for (const margin of [0, 8, 15]) {
    const [a, b] = PAPER_SIDES[paper];
    const count = (pw, ph) => need(W, pw - 2 * margin, 10) * need(H, ph - 2 * margin - 7, 10); // 7 mm header strip per page
    const p = count(a, b), l = count(b, a);
    const auto = tileLayout(W, H, paper, 10, { margin });
    assert.equal(auto.pages, Math.min(p, l), `${paper} ${W}x${H} margin ${margin}`);
    const por = tileLayout(W, H, paper, 10, { margin, orient: 'portrait' }), lan = tileLayout(W, H, paper, 10, { margin, orient: 'landscape' });
    assert.deepEqual([por.orient, por.pages, lan.orient, lan.pages], ['portrait', p, 'landscape', l]);
  }
  assert.equal(tileLayout(100, 100, 'none', 10), null);
  assert.equal(tileLayout(100, 100, 'A4', 140, { margin: 30, orient: 'portrait' }), null, 'no room left for the drawing between the margins and the overlap');
});

test('tileLayout: tiles cover the sheet exactly, overlap by the set amount, and fit the printable area', () => {
  for (const paper of ['A4', 'A3']) for (const [W, H] of [[670, 546], [1070, 796], [190, 243], [300, 800]]) for (const margin of [0, 8, 20]) for (const overlap of [0, 10, 25]) {
    const lay = tileLayout(W, H, paper, overlap, { margin });
    if (!lay) continue;
    assert.ok(lay.tw <= lay.aw + 1e-9 && lay.th <= lay.ah + 1e-9, 'a tile fits the printable area');
    if (lay.nx > 1) { near((lay.nx - 1) * lay.sx + lay.tw, W, 1e-9, 'last tile ends at the sheet edge'); near(lay.tw - lay.sx, lay.overlap, 1e-9, 'neighbours overlap by the set amount'); }
    if (lay.ny > 1) { near((lay.ny - 1) * lay.sy + lay.th, H, 1e-9); near(lay.th - lay.sy, lay.overlap, 1e-9); }
  }
});

test('tileLayout: more margin never means fewer pages; a sheet that fits is one page with no overlap', () => {
  let prev = 0;
  for (let margin = 0; margin <= 25; margin += 1) {
    const lay = tileLayout(670, 546, 'A3', 10, { margin });
    if (!lay) continue;
    assert.ok(lay.pages >= prev, `margin ${margin}`); prev = lay.pages;
  }
  const one = tileLayout(180, 150, 'A4', 10);
  assert.deepEqual([one.pages, one.overlap], [1, 0]);
  const tiles = tileSheets({ W: 180, H: 150, inner: '<rect width="10" height="10"/>', css: '', name: 'x' }, 'A4', 10, 'x');
  assert.equal(tiles.length, 1);
  assert.ok(!tiles[0].svg.includes('class="reg"'), 'nothing to align on a single page');
});

test('every page: right paper size, label and drawing inside the printable area', () => {
  const { s, t, dial } = bladeCfg({ gPolar: true, gBlade: false });
  const sheet = faceSheet(dial, { s, t, place: 'Roma', dateStr: 'x' });
  for (const [paper, orient, margin] of [['A3', 'auto', 8], ['A4', 'portrait', 12], ['A4', 'landscape', 5]]) {
    const tiles = tileSheets(sheet, paper, 10, 'Dial', { orient, margin });
    const [a, b] = PAPER_SIDES[paper];
    assert.ok(tiles.length > 1);
    for (const tl of tiles) {
      assert.ok(tl.pw === Math.min(a, b) || tl.pw === Math.max(a, b));
      assert.match(tl.svg, new RegExp(`width="${tl.pw}mm" height="${tl.ph}mm"`));
      const vb = tl.svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
      const label = tl.svg.match(/<text class="dt" x="(-?[\d.]+)" y="(-?[\d.]+)" style="text-anchor:start">[^<]*margin/).slice(1).map(Number); // the page label, not a dimension text
      const clip = tl.svg.match(/<clipPath[^>]*><rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/).slice(1).map(Number);
      const [lx, ly] = [label[0] - vb[0], label[1] - vb[1]]; // page coordinates, mm
      assert.ok(lx >= margin - 0.01 && ly >= margin && ly <= margin + 7, `label on the page: ${lx}, ${ly}`);
      const [cx, cy] = [clip[0] - vb[0], clip[1] - vb[1]];
      assert.ok(cx >= margin - 0.01 && cy >= margin + 7 - 0.01 && cx + clip[2] <= tl.pw - margin + 0.01 && cy + clip[3] <= tl.ph - margin + 0.01, `drawing area ${cx},${cy} ${clip[2]}x${clip[3]} inside the printable area`);
    }
  }
});

test('clip paths are unique across sheets printed in one document', () => {
  const { s, t, dial } = bladeCfg({ gPolar: true });
  const c = { s, t, place: 'x', dateStr: 'x' };
  const ids = [faceSheet(dial, c), gnomonSheet(dial, c), infoSheet(dial, c)].flatMap((sh) => tileSheets(sh, 'A4', 10, 'x').map((tl) => tl.svg.match(/<clipPath id="([^"]+)"/)[1]));
  assert.equal(new Set(ids).size, ids.length, ids.join(' '));
});

test('black and white print: no colours, families told apart by dashes, no plate fill', () => {
  const colours = /#(?!000\b|fff\b)[0-9a-fA-F]{3,6}\b/;
  for (const lang of ['en', 'it']) {
    const all = { lang, hZone: true, anaZoneNoon: true, hDstLabels: true, dZodiac: true, xItalian: true, xBabylonian: true, xAzimuth: true, xAltitude: true, gBlade: true, motto: 'x' };
    for (const material of ['paper', 'tile']) {
      const { s } = sanitize({ ...DEFAULTS, ...all, material, ink: 'bw' });
      const t = makeT(lang), dial = buildDial(s, t), c = { s, t, place: 'x', dateStr: 'x' };
      for (const sh of [faceSheet(dial, c), gnomonSheet(dial, c), infoSheet(dial, c)]) {
        const svg = svgDoc(sh);
        assert.ok(!colours.test(svg), `${sh.name}: ${(svg.match(colours) || [])[0]}`);
        assert.ok(!/class="tileb"|fill:#f3efe4/.test(svg) || !svg.includes('fill:#f3efe4'), 'no cut-out fill');
        for (const tl of tileSheets(sh, 'A4', 10, 'x')) assert.ok(!colours.test(tl.svg), `${sh.name} page`);
      }
      const css = faceSheet(dial, c).css;
      assert.match(css, /\.plate\{fill:none/, 'plate not filled');
      const dash = (k) => (css.match(new RegExp(`\\.l-${k}\\{[^}]*stroke-dasharray:([^;}]+)`)) || [])[1];
      assert.ok(!dash('hour') && dash('zone') && dash('ital') && dash('bab') && dash('az') && dash('alt'), 'solar solid; zone, Italian, Babylonian, azimuth, altitude dashed');
      assert.equal(new Set(['zone', 'ital', 'bab', 'az', 'alt'].map(dash)).size, 5, 'the dashed families have different patterns');
    }
  }
  const colour = svgDoc(faceSheet(...(() => { const { s, t, dial } = bladeCfg({ gPolar: true }); s.ink = 'color'; return [dial, { s, t, place: 'x', dateStr: 'x' }]; })()));
  assert.match(colour, /#c0392b/, 'the colour version still has its colours');
});

test('print settings are validated and survive the URL', () => {
  const r = (c) => sanitize({ ...DEFAULTS, ...c }).s;
  assert.deepEqual([r({ orient: 'diagonal' }).orient, r({ ink: 'sepia' }).ink, r({ paper: 'A0' }).paper], ['auto', 'color', 'none']);
  assert.deepEqual([r({ printMargin: -5 }).printMargin, r({ printMargin: 99 }).printMargin, r({ printMargin: 'x' }).printMargin], [0, 30, 8]);
  const s = r({ paper: 'A3', orient: 'landscape', printMargin: 5, ink: 'bw' });
  const back = sanitize(Object.fromEntries(new URLSearchParams(serializeState(s)))).s;
  assert.deepEqual([back.paper, back.orient, back.printMargin, back.ink], ['A3', 'landscape', 5, 'bw']);
});

test('the sheets are sized to print: the info sheet and the gnomon template take one A4 page each', () => {
  for (const lang of ['en', 'it']) for (const extra of [{}, { hZone: true, anaZoneNoon: true, xItalian: true, gBlade: true, motto: 'x' }]) {
    const { s } = sanitize({ ...DEFAULTS, lang, ...extra });
    const t = makeT(lang), dial = buildDial(s, t), c = { s, t, place: 'Roma', dateStr: 'x' };
    assert.equal(tileLayout(...[infoSheet(dial, c)].map((x) => [x.W, x.H]).flat(), 'A4', 10).pages, 1, `info sheet on one A4 page (${lang})`);
    if (!extra.gBlade) assert.equal(tileLayout(...[gnomonSheet(dial, c)].map((x) => [x.W, x.H]).flat(), 'A4', 10).pages, 1, `gnomon sheet on one A4 page (${lang})`);
  }
});

test('tileSavings: trimming the stated amount really removes the stated number of pages', () => {
  let offered = 0;
  for (const paper of ['A4', 'A3']) for (const [W, H] of [[670, 546], [660, 530], [1070, 796], [400, 300], [300, 800]]) for (const margin of [0, 5, 8, 12]) for (const orient of ['portrait', 'landscape']) {
    const lay = tileLayout(W, H, paper, 10, { margin, orient });
    const save = tileSavings(W, H, lay);
    if (!save) continue;
    offered++;
    const less = save.axis === 'W' ? [W - save.mm, H] : [W, H - save.mm];
    const after = tileLayout(less[0], less[1], paper, 10, { margin, orient });
    assert.equal(after.pages, lay.pages - save.pages, `${paper} ${orient} ${W}x${H} margin ${margin}: trim ${save.mm} mm of ${save.axis}`);
    assert.ok(save.mm / (save.axis === 'W' ? W : H) <= 0.12, 'only small trims are suggested');
  }
  assert.ok(offered > 10, `the hint is offered for a fair share of layouts (${offered})`);
  assert.equal(tileSavings(670, 546, null), null);
  assert.equal(tileSavings(180, 150, tileLayout(180, 150, 'A4', 10)), null, 'a single page has nothing to save');
  // the default 600 x 450 dial on A3: 8 mm off the height saves a whole row
  const { s } = sanitize({ ...DEFAULTS });
  const dial = buildDial(s, makeT('en')), { W, H } = faceSheetSize(dial, s);
  const lay = tileLayout(W, H, 'A3', 10), save = tileSavings(W, H, lay);
  assert.ok(lay.pages === 6 && save && save.axis === 'H' && save.mm < 12 && save.pages === 2, JSON.stringify({ pages: lay.pages, save }));
});

test('a sheet that fits on one page takes the orientation that matches its shape', () => {
  for (const paper of ['A4', 'A3']) {
    assert.equal(tileLayout(150, 220, paper, 10).orient, 'portrait', `${paper}: tall sheet`);
    assert.equal(tileLayout(220, 150, paper, 10).orient, 'landscape', `${paper}: wide sheet`);
  }
  // the real sheets: the tall info sheet prints upright, the wide gnomon template lies down (A4 forces it anyway)
  const { s } = sanitize({ ...DEFAULTS });
  const t = makeT('en'), dial = buildDial(s, t), c = { s, t, place: 'x', dateStr: 'x' };
  const info = infoSheet(dial, c), gn = gnomonSheet(dial, c);
  assert.equal(tileLayout(info.W, info.H, 'A3', 10).orient, 'portrait');
  assert.equal(tileLayout(gn.W, gn.H, 'A3', 10).orient, 'landscape');
});

// ---- the correction chart ----

const chartFor = (c = {}) => {
  const { s } = sanitize({ ...DEFAULTS, ...c });
  const t = makeT(s.lang), dial = buildDial(s, t), ctx = { s, t, place: 'x', dateStr: 'x' };
  const data = yearCorrections(s.lon, s.tz, s.dst);
  return { s, t, dial, ctx, data, g: correctionGraph(data, { x: 10, y: 28, w: 250, h: 108, t }) };
};
const numbers = (d) => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]]);

test('chart: the curves are the data, in plot coordinates, and the axis contains them with the zero line', () => {
  for (const c of [{}, { lat: -33.87, lon: 151.2, tz: 10, dst: 'AU', D: 45 }, { lon: 12.4964, tz: 13 }, { lon: 15, tz: 1 }]) {
    const { data, g } = chartFor(c);
    const { px, py, pw, ph } = g.box;
    assert.ok(g.lo < 0 && g.hi > 0 && g.lo % 5 === 0 && g.hi % 5 === 0, `axis ${g.lo}..${g.hi} contains zero, on whole steps`);
    for (const d of data) for (const v of [d.solar, d.zone]) assert.ok(v > g.lo && v < g.hi, `${v} inside ${g.lo}..${g.hi}`);
    // the map functions: zero is where the zero axis is drawn, and a day moves right
    near(g.Y(0) , py + ph * (g.hi / (g.hi - g.lo)), 1e-9);
    assert.ok(g.X(0) > px && g.X(364) < px + pw && g.X(100) > g.X(99));
    assert.ok(g.Y(10) < g.Y(0), 'up is positive');
    // the drawn polylines are exactly the data
    const drawn = numbers(g.markup.match(/class="cg-solar" d="([^"]+)"/)[1]);
    assert.equal(drawn.length, 365);
    data.forEach((d, i) => { near(drawn[i][0], g.X(i), 0.006); near(drawn[i][1], g.Y(d.solar), 0.006); });
    const zone = numbers(g.markup.match(/class="cg-zone" d="([^"]+)"/)[1]);
    data.forEach((d, i) => near(zone[i][1], g.Y(d.zone), 0.006));
  }
});

test('chart: summer-time bands match the spans, extremes are labelled with value and date', () => {
  const bands = (g) => [...g.markup.matchAll(/<rect class="cg-dst" x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+"\/>/g)];
  const rome = chartFor();
  // one band in the plot plus one swatch in the legend
  assert.equal(bands(rome.g).length, 2);
  assert.equal(bands(chartFor({ lat: -33.87, lon: 151.2, tz: 10, dst: 'AU', D: 45 }).g).length, 3, 'two bands wrap the new year, plus the legend swatch');
  assert.equal(bands(chartFor({ dst: 'none' }).g).length, 0, 'no summer time: no band, no legend entry');
  // the band spans the right days
  const [x, w] = [+bands(rome.g)[0][1], +bands(rome.g)[0][2]];
  const first = rome.data.findIndex((d) => d.dst), last = rome.data.length - 1 - [...rome.data].reverse().findIndex((d) => d.dst);
  near(x, rome.g.box.px + (first / 365) * rome.g.box.pw, 0.01); near(x + w, rome.g.box.px + ((last + 1) / 365) * rome.g.box.pw, 0.02);
  // labels: the zone-line maximum and minimum, with their dates
  assert.match(rome.g.markup, /\+14\.2 · 11 Feb/); assert.match(rome.g.markup, /−16\.5 · 3 Nov/); assert.match(rome.g.markup, /\+24\.2 · 11 Feb/);
  // when the curves coincide (longitude on the zone meridian) the labels are not doubled
  const same = chartFor({ lon: 15, tz: 1 });
  assert.equal((same.g.markup.match(/·/g) || []).length, 2, 'two labels, not four');
});

test('chart: the marker sits on the curves at the date, and stays inside the plot', () => {
  const { data, g } = chartFor();
  const m = correctionMarker(g, 100.5, data[100].solar, data[100].zone); // local noon of day 100: where that day's point of the curve is
  assert.match(m, new RegExp(`cx="${g.X(100).toFixed(2).replace(/\.?0+$/, '')}`));
  assert.ok(m.includes(`cy="${(Math.round(g.Y(data[100].solar) * 100) / 100)}"`) && m.includes(`cy="${(Math.round(g.Y(data[100].zone) * 100) / 100)}"`));
  const off = correctionMarker(g, 10, 500, -500); // a value far off the chart is pinned to its edge
  assert.ok(off.includes(`cy="${Math.round(g.Y(g.hi) * 100) / 100}"`) && off.includes(`cy="${Math.round(g.Y(g.lo) * 100) / 100}"`));
});

test('chart sheet: one A4 landscape page in both languages, nothing broken, black and white without colour', () => {
  const colours = /#(?!000\b|fff\b)[0-9a-fA-F]{3,6}\b/;
  for (const lang of ['en', 'it']) for (const c of [{}, { lat: -33.87, lon: 151.2, tz: 10, dst: 'AU', D: 45 }, { lon: 12.5, tz: 13, dst: 'none' }]) {
    const { s, t, dial, ctx } = chartFor({ lang, ...c });
    const sh = correctionSheet(dial, ctx), svg = svgDoc(sh);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${lang} ${JSON.stringify(c)}`);
    assert.equal(tileLayout(sh.W, sh.H, 'A4', 10).pages, 1, `fits one A4 page (${sh.W} x ${sh.H})`);
    assert.ok(svg.includes(t('sheetCorr')) && svg.includes(t('cgY')));
    const bw = svgDoc(correctionSheet(dial, { ...ctx, s: { ...s, ink: 'bw' } }));
    assert.ok(!colours.test(bw), `no colour in black and white: ${(bw.match(colours) || [])[0]}`);
  }
  const { dial, ctx } = chartFor();
  assert.ok(svgDoc(correctionSheet(dial, ctx)).includes('#f6e7bf'), 'the colour version shades summer time');
});

test('chart: signed text, the table and the chart agree, and the sheet says the longitude offset with a proper minus', () => {
  const { s, t, dial, ctx, data } = chartFor({ lat: -33.87, lon: 151.2, tz: 10, dst: 'AU', D: 45 });
  assert.ok(svgDoc(correctionSheet(dial, ctx)).includes(`−${Math.abs(lonCorrection(151.2, 10)).toFixed(1)} min`), 'a negative offset prints with −');
  // the info sheet's table is built from the same data: its 1 Nov row has the chart's value for that day
  const nov1 = data[304];
  const info = svgDoc(infoSheet(dial, ctx));
  assert.ok(info.includes(fmtMin(nov1.solar)) && info.includes(fmtMin(nov1.zone)) && info.includes(fmtMin(nov1.eot)));
  // the page's chart uses the page's theme colours, the print chart fixed ones
  assert.ok(graphCss(false, true).includes('var(--ink)') && !graphCss(false, false).includes('var('));
});

test('auto-fit stays within [L_MIN, L_MAX] and reports when it had to relax or clamp', () => {
  for (const lat of [-60, -10, 0, 5, 30, 41.9, 66]) for (const D of [-90, -45, 0, 45, 90, 135, 180]) for (const plate of [{ w: 50, h: 50 }, { w: 600, h: 450 }, { w: 5000, h: 5000 }]) {
    const f = autoFit(lat, D, { ...plate, margin: 4 }, 12, true);
    assert.ok(f.L >= L_MIN && f.L <= L_MAX && Number.isFinite(f.fx) && Number.isFinite(f.fy), `${lat} ${D}`);
  }
  const big = autoFit(41.9, 0, { w: 5000, h: 5000, margin: 4 }, 12, false);
  assert.equal(typeof big.clamped, 'boolean');
});

test('buildDial warns about a time zone far from the place', () => {
  const t = makeT('en');
  const far = buildDial(sanitize({ ...DEFAULTS, lon: 87, tz: 1 }).s, t);
  assert.ok(far.warnings.some((w) => w[0] === 'zoneFar'));
  assert.ok(!buildDial(sanitize({}).s, t).warnings.some((w) => w[0] === 'zoneFar'));
});

test('utcMs treats years 0-99 as themselves; correctionAt agrees with yearCorrections', () => {
  assert.equal(new Date(utcMs(50, 0, 1)).getUTCFullYear(), 50);
  assert.equal(new Date(utcMs(2027, 0, 1, 12)).getUTCFullYear(), 2027);
  const c = yearCorrections(12.5, 1, 'EU')[10];
  assert.deepEqual({ solar: c.solar, zone: c.zone }, correctionAt(12.5, 1, c.eot));
});

test('print job: one document, shared content, pages sized to their sheets; tileSheets only builds one tile', () => {
  const { s } = sanitize({ ...DEFAULTS, plateW: 1000, plateH: 700 });
  const t = makeT('en'), ctx = { s, t, place: 'Test', dateStr: '2026-01-01' };
  const dial = buildDial(s, t);
  const sheets = [[faceSheet(dial, ctx), 'face'], [infoSheet(dial, ctx), 'info']];
  const n = printJobPages(sheets, 'A4', 10, { orient: 'auto', margin: 8 });
  assert.ok(n > 2 && n <= MAX_QUIET_PAGES);
  const html = printJobHtml(sheets, 'A4', 10, { orient: 'auto', margin: 8 }, 'T <x>');
  assert.equal((html.match(/class="pg"/g) || []).length, n);
  assert.ok(html.includes('&lt;x&gt;') && !html.includes('<x>'));
  assert.ok(html.includes('<use'), 'pages refer to shared content');
  assert.ok(!/NaN|undefined/.test(html));
  assert.equal(printJobHtml(sheets, 'none', 10, {}, 'T'), '');
  assert.equal(tileSheets(sheets[0][0], 'A4', 10, 'x', { only: 1 }).length, 1);
});

test('sheets fit one A4 page with a 12 mm printer margin, in both languages', () => {
  for (const lang of ['en', 'it']) for (const plate of [[200, 150], [600, 450]]) {
    const { s } = sanitize({ ...DEFAULTS, lang, plateW: plate[0], plateH: plate[1], gBlade: true });
    const t = makeT(lang), ctx = { s, t, place: 'Test', dateStr: '2026-01-01' };
    const dial = buildDial(s, t);
    for (const sh of [infoSheet(dial, ctx), correctionSheet(dial, ctx)]) {
      const lay = tileLayout(sh.W, sh.H, 'A4', 10, { orient: 'auto', margin: 12 });
      assert.equal(lay.pages, 1, `${sh.name} ${lang} ${plate}`);
    }
  }
});

test('graph CSS only comes with the chart sheet; the chart sheet is black and white clean', () => {
  const { s } = sanitize({ ...DEFAULTS, ink: 'bw' });
  const t = makeT('en'), ctx = { s, t, place: 'Test', dateStr: '2026-01-01' };
  const dial = buildDial(s, t);
  const cs = correctionSheet(dial, ctx);
  assert.ok(cs.css.includes(graphCss(true).slice(0, 20)));
  assert.ok(!infoSheet(dial, ctx).css.includes(graphCss(true).slice(0, 20)));
});

test('rodX is one of the offered multipliers and survives the URL hash', () => {
  assert.deepEqual(ROD_SCALES, [1, 2, 3, 5]);
  for (const [raw, want] of [[2, 2], ['3', 3], [4, 1], [0, 1], [9, 5], ['x', 1]]) assert.equal(sanitize({ rodX: raw }).s.rodX, want, String(raw));
  const { s } = sanitize({ rodX: 5 });
  assert.equal(sanitize(Object.fromEntries(new URLSearchParams(serializeState(s)))).s.rodX, 5);
  assert.equal(serializeState(sanitize({}).s), '');
});

test('oversized rod: the shadow line is rodX times longer, the notch dot stays at the true shadow point', () => {
  const t = makeT('en');
  const { s } = sanitize({ rodX: 1, gPolar: false }), dial = buildDial(s, t);
  const S = [120, 80];
  const line = (sx) => { const m = shadowMarkup(dial, { s: sx, t }, S, []).match(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/); return m.slice(1).map(Number); };
  const one = line(s), three = line({ ...s, rodX: 3 });
  assert.ok(Math.abs((three[2] - one[0]) - 3 * (one[2] - one[0])) < 0.1 && Math.abs((three[3] - one[1]) - 3 * (one[3] - one[1])) < 0.1);
});

test('oversized rod template: ×k long, notch L from the wall, in both languages', () => {
  for (const lang of ['en', 'it']) for (const k of [2, 3, 5]) for (const extra of [{}, { gBlade: true }, { gPolar: false }]) {
    const { s } = sanitize({ ...DEFAULTS, lang, rodX: k, ...extra });
    const t = makeT(lang), dial = buildDial(s, t), sh = gnomonSheet(dial, { s, t, place: 'T', dateStr: 'x' });
    const svg = svgDoc(sh);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${lang} ${k}`);
    assert.ok(svg.includes(`${k}× = ${(k * dial.L).toFixed(1)} mm`), 'overall length');
    assert.ok(svg.includes(`L = ${dial.L.toFixed(1)} mm`), 'notch distance');
    assert.ok(svg.includes(t('rodNotch')), 'notch label');
    assert.ok(sh.W >= k * dial.L + 30 + 20, 'the sheet is as wide as the rod');
  }
  // the rod is not oversized when the rod is off
  const { s } = sanitize({ rodX: 3, gRod: false });
  const t = makeT('en');
  assert.ok(!svgDoc(gnomonSheet(buildDial(s, t), { s, t, place: 'T', dateStr: 'x' })).includes('3× ='));
});

test('fit the dial to one page: it fills the printable area, the best orientation wins', () => {
  const tt = makeT('en');
  for (const paper of ['A4', 'A3']) for (const orient of ['auto', 'portrait', 'landscape']) for (const extra of [{}, { gBlade: true, D: 80 }, { plateW: 300, plateH: 600 }, { rodX: 3 }]) {
    const { s } = sanitize({ ...DEFAULTS, ...extra, paper });
    const opts = { orient, margin: 8 }, fit = fitPlateToPage(s, tt, paper, opts);
    assert.ok(fit && fit.faceBrief, `${paper} ${orient}`);
    const pages = (w, h) => { const sn = { ...s, faceBrief: true, plateW: w, plateH: h }, z = faceSheetSize(buildDial(sn, tt), sn); return tileLayout(z.W, z.H, paper, 10, opts).pages; };
    assert.equal(pages(fit.plateW, fit.plateH), 1, `${paper} ${orient} fits`);
    assert.ok(pages(fit.plateW + 2, fit.plateH) > 1 && pages(fit.plateW, fit.plateH + 2) > 1, `${paper} ${orient} fills the page both ways`);
  }
  // independent of the plate it starts from, and automatic orientation is at least as good as either forced one
  const { s } = sanitize({ ...DEFAULTS, paper: 'A3' }), L = (o) => { const f = fitPlateToPage(s, tt, 'A3', { orient: o, margin: 8 }); return buildDial({ ...s, plateW: f.plateW, plateH: f.plateH }, tt).L; };
  assert.ok(fitPlateToPage(sanitize({}).s, tt, 'A4', { orient: 'portrait', margin: 8 }), 'A4 portrait works with the short caption');
  assert.deepEqual(fitPlateToPage({ ...s, plateW: 100, plateH: 90 }, tt, 'A3', { orient: 'auto', margin: 8 }), fitPlateToPage(s, tt, 'A3', { orient: 'auto', margin: 8 }));
  assert.ok(L('auto') >= Math.max(L('portrait'), L('landscape')) - 1e-9);
  assert.equal(fitPlateToPage(sanitize({}).s, tt, 'none', {}), null);
  const big = (p) => fitPlateToPage(sanitize({}).s, tt, p, { margin: 8 });
  assert.ok(big('A3').plateW * big('A3').plateH > big('A4').plateW * big('A4').plateH);
  assert.ok(fitPlateToPage(sanitize({}).s, tt, 'A4', { orient: 'auto', margin: 2 }).plateH > big('A4').plateH, 'a smaller printer margin gives a bigger dial');
});

test('oversized triangular style: the whole triangle is rodX times bigger, notch on the hypotenuse at the true nodus', () => {
  const t = makeT('en');
  const { s } = sanitize({ rodX: 3, gRod: false }), dial = buildDial(s, t);
  const S = [150, 90], [Rx, Ry] = dial.root, P = dial.plate;
  const pts = (m) => m.match(/<polygon points="([^"]+)"/)[1].split(' ').map((q) => q.split(',').map(Number));
  const [r, fp, ep] = pts(shadowMarkup(dial, { s, t }, S, []));
  const at = (x, y) => [P.fx + x, P.fy - y];
  const near = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 0.1;
  assert.ok(near(r, at(Rx, Ry)) && near(fp, at(-2 * Rx, -2 * Ry)) && near(ep, at(Rx + 3 * (S[0] - Rx), Ry + 3 * (S[1] - Ry))), 'shadow scaled 3x about R');
  assert.equal(pts(shadowMarkup(dial, { s: { ...s, rodX: 1 }, t }, S, [])).length, 3);
  for (const lang of ['en', 'it']) {
    const tl = makeT(lang), sl = { ...s, lang }, d = buildDial(sl, tl);
    const sh = gnomonSheet(d, { s: sl, t: tl, place: 'T', dateStr: 'x' }), svg = svgDoc(sh);
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
    assert.ok(svg.includes(tl('rodNotch')) && svg.includes('R–F = '), lang);
    const a = Math.hypot(d.root[0], d.root[1]);
    assert.ok(svg.includes(`${(3 * a).toFixed(1)} mm`) && svg.includes(`3×L = ${(3 * d.L).toFixed(1)} mm`), 'big base and height');
    assert.ok(sh.W >= 3 * a + 30 && sh.H >= 3 * d.L + 40, 'sheet holds the big triangle');
    // the cut outline has the 3-point notch: 8 vertices instead of 3
    assert.equal(svg.match(/<polygon class="cut" points="([^"]+)"/)[1].split(' ').length, 6);
  }
});

test('fit the gnomon template to one page: the largest scale that fits, shrinking with the oversized options', () => {
  const tt = makeT('en'), opts = { orient: 'auto', margin: 8 };
  const Ls = {};
  for (const [name, extra] of [['plain', {}], ['x3', { rodX: 3 }], ['blade', { gBlade: true }], ['rod', { gPolar: false }]]) {
    const { s } = sanitize({ ...DEFAULTS, ...extra });
    const fit = fitGnomonToPage(s, tt, 'A4', opts);
    assert.ok(fit && fit.L >= L_MIN, name);
    const pages = (L) => { const sn = { ...s, auto: false, L, fx: fit.fx, fy: fit.fy }, sh = gnomonSheet(buildDial(sn, tt), { s: sn, t: tt, place: '', dateStr: '' }); return tileLayout(sh.W, sh.H, 'A4', 10, opts).pages; };
    assert.equal(pages(fit.L), 1, `${name} fits`);
    assert.ok(pages(fit.L + 1) > 1 || fit.L >= L_MAX, `${name} is the largest`);
    Ls[name] = fit.L;
  }
  assert.ok(Ls.x3 < Ls.plain, 'a x3 gnomon needs a smaller L');
  assert.equal(fitGnomonToPage(sanitize({}).s, tt, 'none', opts), null);
  assert.ok(fitGnomonToPage(sanitize({}).s, tt, 'A3', opts).L > Ls.plain);
});

test('short dial caption: smaller sheet, no scale bar, still inside the sheet', () => {
  const t = makeT('en');
  for (const extra of [{}, { plateW: 130, plateH: 90 }, { lang: 'it' }]) {
    const { s } = sanitize({ ...DEFAULTS, ...extra }), full = buildDial(s, makeT(s.lang));
    const sb = { ...s, faceBrief: true }, tb = makeT(s.lang), d = buildDial(sb, tb);
    const a = faceSheetSize(full, s), b = faceSheetSize(d, sb);
    assert.ok(b.H <= a.H - 20 && b.W <= a.W, 'smaller');
    const sh = faceSheet(d, { s: sb, t: tb, place: 'T', dateStr: 'x' });
    assert.deepEqual([sh.W, sh.H], [b.W, b.H]);
    assert.ok(!svgDoc(sh).includes('100 mm</text>') && !/NaN|undefined/.test(svgDoc(sh)));
    assert.ok(svgDoc(faceSheet(full, { s, t: makeT(s.lang), place: 'T', dateStr: 'x' })).includes('100 mm</text>'), 'the full sheet keeps its scale bar');
  }
  assert.equal(sanitize({ faceBrief: '1' }).s.faceBrief, true);
});

test('blade height: bladeR × L everywhere (front view, shadow, template, auto-fit headroom), bounded, in the URL', () => {
  for (const r of [0.3, 0.6, 1, 2, 3]) {
    const { s, dial } = bladeCfg({ bladeR: r });
    near(dial.bladeH, dial.L * r, 1e-9, `r = ${r}`);
    const P = dial.plate;
    // the front view's bar and the shadow triangle reach the blade top
    const bar = frontViewSvg(dial, { s }).match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
    near(+bar[4], P.fy - dial.bladeH, 0.01, 'bar');
    const S = shadowPoint(sunVector(10, 40, s.lat), dial.L, dial.frame);
    assert.ok(shadowMarkup(dial, { s }, S).includes(`${Math.round(P.fx * 100) / 100},${Math.round((P.fy - dial.bladeH) * 100) / 100}`), 'shadow triangle');
    // the template: height dimension, tip angle, and a fold tab whose slanted ends do not cross
    const t = makeT('en'), sh = gnomonSheet(dial, { s, t, place: 'x', dateStr: 'x' }), svg = svgDoc(sh);
    assert.ok(svg.includes(`h = ${dial.bladeH.toFixed(1)} mm`), `h for r = ${r}`);
    assert.ok(svg.includes(`${(Math.atan2(dial.bladeH, dial.L) * 180 / Math.PI).toFixed(1)}°`) || dial.L < 45, 'tip angle');
    const tab = [...svg.matchAll(/<polygon class="cut" points="([^"]+)"/g)].map((m) => m[1].split(' ').map((p) => p.split(',').map(Number)))[1];
    assert.ok(tab[3][1] <= tab[2][1] + 1e-9, `tab ends do not cross for r = ${r}`);
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
    // auto-fit keeps the blade top on the plate
    assert.ok(P.fy - dial.bladeH >= P.margin - 1, `blade top inside the plate for r = ${r}`);
  }
  const r = (v) => sanitize({ ...DEFAULTS, bladeR: v }).s.bladeR;
  assert.deepEqual([r(0.1), r(9), r(1.5)], [0.3, 3, 1.5]);
  assert.equal(DEFAULTS.bladeR, 1, 'the 45° blade by default');
  const back = sanitize(Object.fromEntries(new URLSearchParams(serializeState(sanitize({ ...DEFAULTS, gBlade: true, bladeR: 0.5 }).s)))).s;
  assert.equal(back.bladeR, 0.5);
});
