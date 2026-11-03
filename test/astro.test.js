import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarParams, sunAt, isDst, civilFromUtc, utcFromCivil, sunsetHourAngle, sunVector, lonCorrection, yearCorrections, dayMs } from '../js/astro.js';
import { DEFAULTS, sanitize, buildDial } from '../js/state.js';
import { infoSheet, svgDoc } from '../js/svg.js';
import { makeT } from '../js/i18n.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('declination at solstices and equinox', () => {
  near(solarParams(Date.UTC(2026, 5, 21, 8, 24)).decl, 23.44, 0.01, 'June solstice');
  near(solarParams(Date.UTC(2026, 11, 21, 20, 50)).decl, -23.44, 0.01, 'December solstice');
  near(solarParams(Date.UTC(2026, 2, 20, 14, 46)).decl, 0, 0.02, 'March equinox');
});

test('equation of time extremes (published values)', () => {
  near(solarParams(Date.UTC(2026, 10, 3, 12)).eot, 16.4, 0.2, 'early November maximum');
  near(solarParams(Date.UTC(2026, 1, 11, 12)).eot, -14.2, 0.2, 'mid February minimum');
  near(solarParams(Date.UTC(2026, 3, 15, 12)).eot, 0, 0.4, 'crosses zero mid April');
});

test('noon altitude in Rome at the equinox is 90° − latitude', () => {
  let best = -90;
  for (let m = 9 * 60; m < 13 * 60; m++) best = Math.max(best, sunAt(Date.UTC(2026, 2, 20, 0, m), 41.9028, 12.4964).alt);
  near(best, 90 - 41.9028, 0.3);
});

test('sun vector is a unit vector; azimuth south at noon', () => {
  const s = sunVector(10, 0, 45);
  near(Math.hypot(...s), 1, 1e-12);
  assert.ok(s[1] < 0 && Math.abs(s[0]) < 1e-12, 'noon sun due south in the northern hemisphere');
  const a = sunVector(10, 30, 45);
  assert.ok(a[0] < 0, 'afternoon sun is in the west');
});

test('sunset hour angle', () => {
  near(sunsetHourAngle(41.9, 0), 90, 1e-9, 'equinox: 6 h after noon');
  assert.equal(sunsetHourAngle(80, 20), 180, 'midnight sun');
  assert.equal(sunsetHourAngle(80, -20), 0, 'polar night');
});

test('EU summer time 2026 boundaries', () => {
  assert.equal(isDst(Date.UTC(2026, 2, 29, 0, 59), 1, 'EU'), false);
  assert.equal(isDst(Date.UTC(2026, 2, 29, 1, 0), 1, 'EU'), true);
  assert.equal(isDst(Date.UTC(2026, 9, 25, 0, 59), 1, 'EU'), true);
  assert.equal(isDst(Date.UTC(2026, 9, 25, 1, 0), 1, 'EU'), false);
  assert.equal(isDst(Date.UTC(2026, 6, 1), 1, 'none'), false);
  assert.equal(isDst(Date.UTC(2026, 0, 10), 10, 'AU'), true, 'southern summer');
});

test('civil time round trip', () => {
  for (const [y, mo, d, h, mi] of [[2026, 0, 15, 9, 30], [2026, 6, 15, 16, 30], [2026, 9, 25, 12, 0]]) {
    const ms = utcFromCivil(y, mo, d, h, mi, 1, 'EU');
    const c = civilFromUtc(ms, 1, 'EU');
    assert.deepEqual([c.y, c.mo, c.d, c.h, c.mi], [y, mo, d, h, mi]);
  }
  assert.equal(civilFromUtc(Date.UTC(2026, 6, 15, 14, 30), 1, 'EU').h, 16, 'CEST = UTC+2');
});

// ---- longitude correction, including zones east/west of the date line ----

const PLACES = [ // name, lat, lon, standard UTC offset
  ['Rome', 41.9, 12.5, 1], ['Apia (Samoa)', -13.8, -171.8, 13], ['Kiritimati', 1.9, -157.4, 14], ['Suva (Fiji)', -18.1, 178.4, 12],
  ['Auckland', -36.8, 174.8, 12], ['Honolulu', 21.3, -157.9, -10], ['Pago Pago', -14.3, -170.7, -11], ['Anchorage', 61.2, -149.9, -9],
];

test('lonCorrection is wrapped across the date line', () => {
  const want = { 'Rome': 10, 'Apia (Samoa)': 27.2, 'Kiritimati': 29.6, 'Suva (Fiji)': 6.4, 'Honolulu': 31.6 };
  for (const [name, , lon, tz] of PLACES) {
    const c = lonCorrection(lon, tz);
    assert.ok(Math.abs(c) < 120, `${name}: ${c} min is not plausible for a place inside its own zone`);
    if (name in want) near(c, want[name], 0.05, name);
  }
  for (let lon = -180; lon <= 180; lon += 7) for (let tz = -12; tz <= 14; tz++) {
    assert.ok(Math.abs(lonCorrection(lon, tz)) <= 720 + 1e-9, `lon ${lon} tz ${tz}`); // never more than 12 h
  }
});

test('true solar noon on the clock matches 12:00 + lonCorrection − EoT, worldwide', () => {
  for (const [name, lat, lon, tz] of PLACES) {
    const day = Date.UTC(2027, 0, 15);
    let best = null;
    for (let m = 0; m < 1440; m++) { const a = sunAt(day + m * 60000, lat, lon); if (!best || a.alt > best.alt) best = { alt: a.alt, m, eot: a.eot }; }
    const c = civilFromUtc(day + best.m * 60000, tz, 'none');
    const clock = c.h * 60 + c.mi;
    const predicted = 720 + lonCorrection(lon, tz) - best.eot;
    const diff = Math.abs(((clock - predicted + 720) % 1440 + 1440) % 1440 - 720);
    assert.ok(diff < 2.5, `${name}: solar noon at ${clock} min on the clock, predicted ${predicted.toFixed(1)}`);
  }
});

test('the info sheet at the date line has no multi-hour corrections', () => {
  const { s } = sanitize({ ...DEFAULTS, lat: -13.8, lon: -171.8, tz: 13, dst: 'none', D: 135 });
  const t = makeT('en');
  const svg = svgDoc(infoSheet(buildDial(s, t), { s, t, place: 'Apia', dateStr: 'x' }));
  assert.ok(!/[+−]\d{3,} m/.test(svg), 'no three-digit minute values in the correction table');
});

// ---- the correction through the year (the data behind the table and the chart) ----

const spans = (data) => { const r = []; data.forEach((d, i) => { if (d.dst) { const l = r[r.length - 1]; if (l && l[1] === i - 1) l[1] = i; else r.push([i, i]); } }); return r; };

test('yearCorrections: solar lines = longitude − EoT, zone lines = −EoT, one entry per day', () => {
  const rome = yearCorrections(12.4964, 1, 'EU'), lc = lonCorrection(12.4964, 1);
  assert.equal(rome.length, 365);
  rome.forEach((d, i) => {
    assert.equal(d.i, i);
    near(d.eot, solarParams(dayMs(i)).eot, 1e-12);
    near(d.solar, lc - d.eot, 1e-12); near(d.zone, -d.eot, 1e-12);
  });
  const zone = rome.map((d) => d.zone);
  near(Math.max(...zone), 14.2, 0.2, 'mid-February: the sun is 14 min slow, so add 14 min');
  near(Math.min(...zone), -16.5, 0.2, 'early November: the sun is 16.5 min fast, so subtract 16.5');
  const when = new Date(dayMs(rome.findIndex((d) => d.zone === Math.min(...zone))));
  assert.deepEqual([when.getUTCMonth(), when.getUTCDate()], [10, 3], 'the minimum falls on 3 November');
});

test('yearCorrections: summer time spans, including the southern ones that wrap the new year', () => {
  const rome = spans(yearCorrections(12.4964, 1, 'EU'));
  assert.equal(rome.length, 1);
  assert.ok(rome[0][0] >= 85 && rome[0][0] <= 88, `starts late March: ${rome[0]}`);
  assert.ok(rome[0][1] >= 301 && rome[0][1] <= 304, `ends late October: ${rome[0]}`);
  const sydney = spans(yearCorrections(151.2, 10, 'AU'));
  assert.equal(sydney.length, 2, 'Jan to early April, and October to December');
  assert.equal(sydney[0][0], 0); assert.equal(sydney[1][1], 364);
  assert.ok(sydney[0][1] >= 90 && sydney[0][1] <= 94 && sydney[1][0] >= 273 && sydney[1][0] <= 277, JSON.stringify(sydney));
  assert.equal(spans(yearCorrections(12.4964, 1, 'none')).length, 0);
  assert.equal(spans(yearCorrections(-74, -5, 'US')).length, 1);
});
