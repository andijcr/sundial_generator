import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarParams, sunAt, isDst, civilFromUtc, utcFromCivil, sunsetHourAngle, sunVector } from '../js/astro.js';

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
