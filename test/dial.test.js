import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunVector, DEG } from '../js/astro.js';
import { wallFrame, shadowPoint, styleRoot, dialAngles, dot, poleAxis, autoFit, clipPolyline, sunStats, bladeHeight, BLADE_RATIO, absoluteDeclination, relativeDeclination, wallLimit, TROPIC_LAT } from '../js/dial.js';
import { DEFAULTS, sanitize, buildDial, serializeState, dstLabelsApply, wallPresetsFor, wallDirectionName } from '../js/state.js';
import { faceSheet, faceSheetSize, gnomonSheet, infoSheet, svgDoc, tileSheets, tileLayout, frontViewSvg, shadowMarkup } from '../js/svg.js';
import { fmtHM } from '../js/astro.js';
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
    { gBlade: true }, { gPolar: false, gRod: false, gBlade: true }, { gPolar: false, gRod: false, gBlade: true, D: 90, plateW: 200, plateH: 150 },
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
