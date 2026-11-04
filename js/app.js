// UI wiring: state <-> controls, rendering, time loop, downloads.

import { isDst, sunAt, civilFromUtc, utcFromCivil, norm180, fmtHM, lonCorrection, yearCorrections, correctionAt, dayOfYear, hourAngleAtClock, sunVector, altAz, RAD } from './astro.js';
import { shadowPoint, absoluteDeclination, relativeDeclination, wallLimit, wallFromShadow, circularMean, compassHeading, BETA_POOR, sunlightGrid, sunState, SUN, yearTable, dot } from './dial.js';
import { sunChart, sunChartMarker, sunChartCss, frontViewSvg, shadowMarkup, trailMarkup, faceSheet, faceSheetSize, infoSheet, correctionSheet, testSheet, gnomonSheetFor, correctionGraph, correctionMarker, graphCss, fmtMin, svgDoc, tileSheets, tileLayout, tileSavings, tileName, printJobPages, printJobHtml, MAX_QUIET_PAGES } from './svg.js';
import { DEFAULTS, PRESETS, wallPresetsFor, sanitize, buildDial, fitPlateToPage, fitGnomonScale, rodXApplies, ROD_MAX, serializeState, dstLabelsApply, clockOn, tipOn } from './state.js';
import { makeT } from './i18n.js';
import { View3D } from './view3d.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSigned = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);

let inputWarnings = [];
let state = loadState();
let t = makeT(state.lang);
let dial = null;
const view3d = new View3D($('#view3d'));
const time = { mode: 'live', ms: Date.now(), anim: 'off', speed: 1, trail: [], trailOn: true, yearClock: null, yearAcc: 0, last: 0 };

// ---------------- state persistence (URL hash) ----------------
function loadState() {
  const p = new URLSearchParams(location.hash.slice(1));
  const raw = {};
  for (const [k, v] of p) if (Object.hasOwn(DEFAULTS, k)) raw[k] = v;
  const r = sanitize(raw);
  inputWarnings = r.warnings;
  return r.s;
}
let hashTimer = 0;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = serializeState(state);
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }, 250);
}

// ---------------- i18n ----------------
function applyLang() {
  t = makeT(state.lang);
  document.documentElement.lang = state.lang;
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n, ROD_MAX); // only rodX's label has a placeholder
  for (const b of $$('[data-lang-btn]')) b.setAttribute('aria-pressed', String(b.dataset.langBtn === state.lang));
  fillSelects();
}
function fillSelects() {
  const place = $('#place');
  place.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('') + `<option value="custom">${t('custom')}</option>`;
  place.value = state.place;
  fillWallPresets(true);
}
// The offered wall directions depend on the latitude (hemisphere, and tropics or not): rebuild only when that changes.
let wallKey = '';
function fillWallPresets(force) {
  const key = `${state.lat < 0}|${wallLimit(state.lat)}|${state.lang}`;
  if (force || key !== wallKey) {
    wallKey = key;
    const dirs = t('dirs');
    $('#wallPreset').innerHTML = `<option value="">${t('custom')}</option>` +
      wallPresetsFor(state.lat).map((p) => `<option value="${p.D}">${dirs[p.key] || p.key} (D = ${p.D}°)</option>`).join('');
  }
  const hit = [...$('#wallPreset').options].find((o) => o.value !== '' && Math.abs(Number(o.value) - state.D) < 1e-6);
  $('#wallPreset').value = hit ? hit.value : '';
}

// ---------------- controls ----------------
function writeControls() {
  const lim = wallLimit(state.lat); // set before the values below: assigning a value clamps it to the current range
  for (const el of $$('[data-k="D"]')) { el.min = -lim; el.max = lim; }
  $('#wallRange').textContent = t(lim === 180 ? 'wallRangeAny' : 'wallRangeSun');
  for (const el of $$('[data-k]')) {
    const k = el.dataset.k;
    if (k === 'place') continue;
    let v = state[k];
    if (state.auto && dial && (k === 'L' || k === 'fx' || k === 'fy')) v = k === 'L' ? dial.L : dial.plate[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = typeof v === 'number' ? +v.toFixed(4) : v;
  }
  for (const el of $$('.manual')) el.disabled = state.auto;
  const rodOn = dial ? rodXApplies(state, dial) : true; // it lengthens the rod and the style edge (where the wall allows one)
  $('[data-k="rodX"]').disabled = !rodOn;
  $('[data-k="rodX"]').max = ROD_MAX;
  $('[data-k="fitGnomonX"]').disabled = state.paper === 'none' || !rodOn; // an option of 'fit to one page', which needs a paper size
  $('[data-k="bladeR"]').disabled = !state.gBlade; // only the blade has a height
  $('[data-k="hExtend"]').disabled = !state.gPolar; // the style root only exists for the triangular style
  $('[data-k="hDstLabels"]').disabled = !dstLabelsApply(state); // needs lines that read clock time
  // the wall-clock figure-8s are read at the rod's tip, and they replace the other time lines (whose controls then do nothing)
  const clk = clockOn(state);
  $('[data-k="anaClock"]').disabled = !state.gRod;
  for (const k of ['hSolar', 'hZone', 'hHalf', 'hQuarter', 'hTen', 'hExtend', 'anaMeanNoon', 'anaZoneNoon', 'anaHours', 'anaMonthTicks']) $(`[data-k="${k}"]`).disabled = clk;
  if (!clk) $('[data-k="hExtend"]').disabled = !state.gPolar;
  if (!clk) $('[data-k="hQuarter"]').disabled = state.hTen; // 10-minute lines take the place of quarters
  $('[data-k="dTicks10"]').disabled = !clk;
  $('[data-k="rodTip"]').disabled = !clk || !(state.rodX > 1); // needs the wall-clock 8s and an oversized rod (a tip beyond the notch)
  // with the tip reading winter time the multiplier is part of the dial, so the gnomon fit (which changes it) is off
  if (state.rodTip && clk) $('[data-k="fitGnomonX"]').disabled = true;
  $('#facesAz').textContent = `${((180 + absoluteDeclination(state.lat, state.D) + 360) % 360).toFixed(1)}° (N→E)`;
  $('#frontWrap').hidden = !state.v2d;
  $('#v3dWrap').hidden = !state.v3d;
  $('.views').classList.toggle('both', state.v2d && state.v3d);
}

function readControl(el) {
  const k = el.dataset.k;
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number' || el.type === 'range') return el.value === '' ? state[k] : Number(el.value);
  return el.value;
}

function onControl(e) {
  const el = e.target.closest('[data-k]');
  if (!el) return;
  const k = el.dataset.k;
  const v = readControl(el);
  if (k === 'place') {
    if (Object.hasOwn(PRESETS, v)) { const p = PRESETS[v]; Object.assign(state, { place: v, lat: p.lat, lon: p.lon, tz: p.tz, dst: p.dst }); }
    else state.place = 'custom';
  } else {
    // in auto mode, editing L / foot switches to manual using current values
    if ((k === 'L' || k === 'fx' || k === 'fy') && state.auto) Object.assign(state, { auto: false, L: dial.L, fx: dial.plate.fx, fy: dial.plate.fy });
    if (k === 'auto' && !v && dial) Object.assign(state, { L: dial.L, fx: dial.plate.fx, fy: dial.plate.fy });
    state[k] = v;
    if (['lat', 'lon', 'tz', 'dst'].includes(k)) state.place = 'custom';
    if ((k === 'hQuarter' || k === 'hTen') && v) state.hHalf = true;
  }
  update();
  // A number field keeps focus after Enter and is then not rewritten: show the value that was actually used (it may have been clamped).
  if (el.type === 'number' && typeof state[k] === 'number') el.value = +state[k].toFixed(4);
}

// ---------------- main update ----------------
function update() {
  const r = sanitize(state);
  state = r.s;
  const warns = [...inputWarnings, ...r.warnings];
  inputWarnings = [];
  t = makeT(state.lang);
  dial = buildDial(state, t);
  if (state.v2d) $('#front').innerHTML = frontViewSvg(dial, { s: state, t });
  $('#place').value = state.place;
  fillWallPresets(false);
  writeControls();
  const all = [...warns, ...dial.warnings];
  $('#warnings').innerHTML = all.map(([k, ...a]) => `<li>⚠ ${t('w_' + k, ...a)}</li>`).join('');
  updateLearn();
  updateTiles();
  time.trail = [];
  saveHash();
  refreshMeasure();
  renderCorrection();
  renderSun();
  renderTime();
}

// ---------------- when the sun reaches the wall ----------------
let sunView = null; // { grid, chart } of the chart on the page, for the marker and the hover readout
let sunKey = ''; // the marker's current position (redrawn only when it moves)
function renderSun() {
  sunKey = '';
  const D = absoluteDeclination(state.lat, state.D);
  const grid = sunlightGrid(state.lat, state.lon, state.tz, D, dial.horizon, state.grazing);
  const chart = sunChart(grid, { x: 0, y: 0, w: 262, h: 120, t, dst: yearCorrections(state.lon, state.tz, state.dst), grazing: state.grazing });
  sunView = { grid, chart, D };
  const tip = $('#sunTip');
  $('#sunGraph').innerHTML = `<svg viewBox="0 0 262 120" role="img" aria-label="${esc(t('sunTitle'))}"><style>${sunChartCss()}</style>${chart.markup}<g id="sc-now"></g></svg>`;
  $('#sunGraph').append(tip);
  const day = (c) => { const d = yearTable()[c.i]; return `${d.dom} ${t('monthsShort')[d.m]}`; };
  const open = dial.horizon.length ? t('sunSummaryHz', grid.avgOpen.toFixed(1)) : '';
  $('#sunNow').textContent = t('sunSummary', grid.avg.toFixed(1), open, grid.max.litH.toFixed(1), day(grid.max), grid.min.litH.toFixed(1), day(grid.min));
}
function updateSunMarker() {
  if (!sunView) return;
  const c = civilFromUtc(time.ms, state.tz, 'none'); // the chart is in standard time: date and time without summer time (00:30 summer time is 23:30 the day before)
  const days = Math.min(364.99, dayOfYear(c.mo, c.d) + 0.5), min = c.h * 60 + c.mi;
  const key = `${days}|${min}`;
  if (key === sunKey) return;
  sunKey = key;
  const g = $('#sc-now');
  if (g) g.innerHTML = sunChartMarker(sunView.chart, days, min);
}
// hover: what the cell under the pointer means, and the sun's position then
function bindSunHover() {
  const box = $('#sunGraph'), tip = $('#sunTip');
  box.addEventListener('pointermove', (e) => {
    const svg = box.querySelector('svg');
    if (!svg || !sunView) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const { px, py, pw, ph } = sunView.chart.box, { grid } = sunView;
    if (p.x < px || p.x > px + pw || p.y < py || p.y > py + ph) { tip.hidden = true; return; }
    const col = grid.cols[Math.min(grid.cols.length - 1, Math.floor(((p.x - px) / pw) * 365 / grid.stepDays))];
    const min = sunView.chart.t0 + ((p.y - py) / ph) * (sunView.chart.t1 - sunView.chart.t0), k = Math.min(grid.n - 1, Math.floor(min / grid.stepMin));
    const d = yearTable()[col.i], code = col.codes[k];
    const s = sunVector(d.decl, hourAngleAtClock((k + 0.5) * grid.stepMin, state.lon, state.tz, d.eot), state.lat);
    const name = { [SUN.night]: t('sunNight'), [SUN.behind]: t('sunBehind'), [SUN.hidden]: t('sunHidden'), [SUN.graze]: t('sunGraze', state.grazing), [SUN.lit]: t('sunLit') }[code];
    const extra = code === SUN.night ? '' : ` · ${t('sunTipSun', altAz(s).alt.toFixed(0), (Math.asin(Math.max(-1, Math.min(1, dot(s, dial.frame.n)))) * RAD).toFixed(0))}`;
    tip.textContent = t('sunTip', `${d.dom} ${t('monthsShort')[d.m]}`, fmtHM(k * grid.stepMin), name) + extra;
    tip.hidden = false;
    const r = box.getBoundingClientRect(), tw = tip.offsetWidth; // centred on the pointer, but kept inside the chart
    tip.style.left = `${Math.min(r.width - tw, Math.max(0, e.clientX - r.left - tw / 2))}px`;
    tip.style.top = `${e.clientY - r.top}px`;
  });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ---------------- correction chart ----------------
let corr = null; // the chart's coordinate functions, for the "today" marker
// The chart depends on the place, the time zone and summer time, and on the language: rebuilt on update(); only the marker moves with time.
function renderCorrection() {
  markerKey = ''; // the chart is rebuilt below, so the marker has to be drawn again
  corr = correctionGraph(yearCorrections(state.lon, state.tz, state.dst), { x: 0, y: 0, w: 262, h: 112, t });
  $('#corrGraph').innerHTML = `<svg viewBox="0 0 262 112" role="img" aria-label="${esc(t('corrTitle'))}"><style>${graphCss(false, true)}</style>${corr.markup}<g id="cg-today"></g></svg>`;
}
let markerKey = ''; // what the marker currently shows: nothing is redrawn while it would look the same (live mode ticks every second)
function updateCorrectionMarker(sun, c) {
  if (!corr) return;
  const key = `${c.mo}-${c.d}-${c.h}-${c.mi}-${c.dst}`;
  if (key === markerKey) return;
  markerKey = key;
  // days since the start of the year; the curve's point for a day is its noon, so local noon on day i is i + 0.5
  const days = Math.min(364.99, dayOfYear(c.mo, c.d) + (c.h * 60 + c.mi) / 1440);
  const { solar, zone } = correctionAt(state.lon, state.tz, sun.eot);
  $('#cg-today').innerHTML = correctionMarker(corr, days, solar, zone);
  $('#corrNow').textContent = t('cgToday', `${c.d} ${t('monthsShort')[c.mo]}`, fmtMin(solar), fmtMin(zone), c.dst ? t('cgTodayDst') : '');
}

function updateLearn() {
  const a = dial.angles;
  const subH = 12 + a.DL / 15;
  const v = {
    D: `${absoluteDeclination(state.lat, state.D).toFixed(1)}°`, L: `${dial.L.toFixed(0)} mm`,
    SH: `${a.SH.toFixed(2)}°`, SD: `${a.SD.toFixed(2)}°`, DL: `${a.DL.toFixed(2)}°`, subH: fmtHM(subH * 60),
    R: dial.root ? `(${dial.root[0].toFixed(1)}, ${dial.root[1].toFixed(1)})` : '—',
    lonCorr: `${fmtSigned(lonCorrection(state.lon, state.tz))} min`,
    lit: `${dial.stats.litPerDay.toFixed(1)} h`,
  };
  for (const el of $$('[data-v]')) if (el.dataset.v in v) el.textContent = v[el.dataset.v];
}

// ---------------- time ----------------
function setChosen(ms) {
  time.mode = 'chosen';
  time.ms = ms;
  $$('input[name="tmode"]').forEach((r) => { r.checked = r.value === 'chosen'; });
}

function syncTimeInputs() {
  const c = civilFromUtc(time.ms, state.tz, state.dst);
  const ae = document.activeElement;
  if (ae !== $('#tDate')) $('#tDate').value = `${String(c.y).padStart(4, '0')}-${pad2(c.mo + 1)}-${pad2(c.d)}`; // a date input wants four digits
  if (ae !== $('#tTime')) $('#tTime').value = `${pad2(c.h)}:${pad2(c.mi)}`;
  const doy = Math.round((Date.UTC(c.y, c.mo, c.d) - Date.UTC(c.y, 0, 1)) / 86400000);
  if (ae !== $('#tDoy')) $('#tDoy').value = doy;
  if (ae !== $('#tMin')) $('#tMin').value = c.h * 60 + c.mi;
  return c;
}

function renderTime() {
  if (!dial) return;
  if (time.mode === 'live') time.ms = Date.now();
  const c = syncTimeInputs();
  const sun = sunAt(time.ms, state.lat, state.lon);
  const hidden = sunState(sun.vec, dial.frame, dial.horizon) === SUN.hidden; // behind an obstacle: no shadow on the dial
  const S = hidden ? null : shadowPoint(sun.vec, dial.L, dial.frame);
  if (S && time.trailOn && time.anim !== 'off') {
    time.trail.push(S);
    if (time.trail.length > 4000) time.trail.shift();
  }
  if (state.v2d) {
    const sh = $('#front #shadow'), tr = $('#front #trail');
    if (sh) sh.innerHTML = shadowMarkup(dial, { s: state }, S);
    if (tr) tr.innerHTML = time.trailOn ? trailMarkup(dial, time.trail) : '';
  }
  if (state.v3d) {
    view3d.setScene({ dial, sun: sun.vec, decl: sun.decl, lat: state.lat, S, D: absoluteDeclination(state.lat, state.D), gPolar: state.gPolar, gRod: state.gRod, gBlade: state.gBlade, rodX: state.rodX, trail: time.trailOn ? time.trail : [] });
  }
  // readout
  updateCorrectionMarker(sun, c);
  updateSunMarker();
  const lit = sun.alt > 0 && S;
  const status = sun.alt <= 0 ? t('rNight') : lit ? t('rOnWall') : hidden ? t('rHidden') : t('rBehind');
  const zoneRead = sun.solarMin + lonCorrection(state.lon, state.tz);
  $('#readout').innerHTML = [
    `${t('rClock')}: <b>${c.y}-${pad2(c.mo + 1)}-${pad2(c.d)} ${pad2(c.h)}:${pad2(c.mi)}</b> (UTC${c.off >= 0 ? '+' : ''}${c.off}${c.dst ? ' DST' : ''})`,
    `${t('rSolar')}: <b>${fmtHM(sun.solarMin)}</b>`,
    `${t('rZoneDial')}: <b>${fmtHM(zoneRead)}</b>`,
    `${t('rEot')}: <b>${fmtSigned(sun.eot)} min</b>`,
    `${t('rDecl')}: <b>${fmtSigned(sun.decl, 2)}°</b>`,
    `${t('rAlt')}: <b>${sun.alt.toFixed(1)}°</b>`,
    `${t('rAz')}: <b>${sun.az.toFixed(1)}°</b>`,
    `<span class="${lit ? 'state-on' : 'state-off'}">● ${status}</span>`,
    `${t('rLit')}: <b>${dial.stats.litPerDay.toFixed(1)}</b> ${t('hPerDay')}`,
  ].map((x) => `<span>${x}</span>`).join('');
  const v = { decl: `${fmtSigned(sun.decl, 2)}°`, eot: `${fmtSigned(sun.eot)} min`, H: `${fmtSigned(sun.H)}°` };
  for (const el of $$('[data-v]')) if (el.dataset.v in v) el.textContent = v[el.dataset.v];
}

const DAY_SPEED = [20, 90, 360]; // minutes per second
const YEAR_SPEED = [4, 12, 40]; // days per second
function tick(now) {
  const dt = time.last ? Math.min(0.1, (now - time.last) / 1000) : 0;
  time.last = now;
  if (time.anim === 'day') {
    time.ms += dt * DAY_SPEED[time.speed] * 60000;
    renderTime();
  } else if (time.anim === 'year') {
    time.yearAcc += dt * YEAR_SPEED[time.speed];
    const steps = Math.floor(time.yearAcc);
    if (steps > 0) {
      time.yearAcc -= steps;
      const c = civilFromUtc(time.ms, state.tz, state.dst);
      const [h, mi] = time.yearClock;
      time.ms = utcFromCivil(c.y, c.mo, c.d + steps, h, mi, state.tz, state.dst);
      renderTime();
    }
  } else if (time.mode === 'live' && now - (time.liveLast || 0) > 1000) {
    time.liveLast = now;
    renderTime();
  }
  requestAnimationFrame(tick);
}

function bindTime() {
  $$('input[name="tmode"]').forEach((r) => r.addEventListener('change', () => {
    time.mode = r.value;
    if (time.mode === 'live') { time.anim = 'off'; $('#anim').value = 'off'; }
    time.trail = [];
    renderTime();
  }));
  $('#nowBtn').addEventListener('click', () => { time.ms = Date.now(); setChosen(time.ms); time.trail = []; renderTime(); });
  const fromInputs = () => {
    const [y, mo, d] = ($('#tDate').value || '').split('-').map(Number);
    const [h, mi] = ($('#tTime').value || '').split(':').map(Number);
    if (![y, mo, d, h, mi].every(Number.isFinite)) return;
    setChosen(utcFromCivil(y, mo - 1, d, h, mi, state.tz, state.dst));
    renderTime();
  };
  $('#tDate').addEventListener('change', fromInputs);
  $('#tTime').addEventListener('change', fromInputs);
  $('#tDoy').addEventListener('input', (e) => {
    const c = civilFromUtc(time.ms, state.tz, state.dst);
    setChosen(utcFromCivil(c.y, 0, 1 + Number(e.target.value), c.h, c.mi, state.tz, state.dst));
    renderTime();
  });
  $('#tMin').addEventListener('input', (e) => {
    const c = civilFromUtc(time.ms, state.tz, state.dst);
    const m = Number(e.target.value);
    setChosen(utcFromCivil(c.y, c.mo, c.d, Math.floor(m / 60), m % 60, state.tz, state.dst));
    renderTime();
  });
  $('#anim').addEventListener('change', (e) => {
    time.anim = e.target.value;
    time.trail = [];
    if (time.anim !== 'off') {
      setChosen(time.ms);
      const c = civilFromUtc(time.ms, state.tz, state.dst);
      time.yearClock = [c.h, c.mi];
      time.yearAcc = 0;
    }
    renderTime();
  });
  $('#speed').addEventListener('change', (e) => { time.speed = Number(e.target.value); });
  $('#trailOn').addEventListener('change', (e) => { time.trailOn = e.target.checked; time.trail = []; renderTime(); });
}

// ---------------- wall measuring helpers ----------------
let refreshMeasure = () => {}; // set by bindMeasure; update() calls it when the place or time zone changes
function bindMeasure() {
  const now = civilFromUtc(Date.now(), state.tz, state.dst);
  $('#mDate').value = `${now.y}-${pad2(now.mo + 1)}-${pad2(now.d)}`;
  $('#mTime').value = `${pad2(now.h)}:${pad2(now.mi)}`;
  let shadowD = null, compassD = null, meanD = null;
  const readings = []; // shadow readings kept for averaging: { date, time, beta } (recomputed when the place changes)
  const fromReading = (date, time, beta) => {
    const [y, mo, d] = (date || '').split('-').map(Number);
    const [h, mi] = (time || '').split(':').map(Number);
    if (![y, mo, d, h, mi].every(Number.isFinite)) return undefined;
    const sun = sunAt(utcFromCivil(y, mo - 1, d, h, mi, state.tz, state.dst), state.lat, state.lon);
    return { sun, D: sun.alt > 0 ? relativeDeclination(state.lat, wallFromShadow(sun.az, beta)) : null };
  };
  const calc = () => {
    const beta = Number($('#mBeta').value) || 0;
    const r = fromReading($('#mDate').value, $('#mTime').value, beta);
    if (r) {
      shadowD = r.D;
      $('#mShadowOut').textContent = shadowD === null ? t('mNoSun') : `${shadowD.toFixed(1)}°  (${t('mSunAz')} ${r.sun.az.toFixed(1)}°)`;
    }
    $('#mShadowWarn').hidden = Math.abs(beta) < BETA_POOR;
    $('#mShadowWarn').textContent = t('mBetaPoor');
    // the kept readings and their mean
    const ds = [];
    $('#mReadings').innerHTML = readings.map((rd, i) => {
      const x = fromReading(rd.date, rd.time, rd.beta);
      if (x?.D != null) ds.push(x.D);
      return `<li><span>${esc(t('mReading', rd.date, rd.time, rd.beta, x?.D == null ? '—' : x.D.toFixed(1)))}</span><button type="button" data-rm="${i}" aria-label="${esc(t('mRemove'))}">✕</button></li>`;
    }).join('');
    const m = circularMean(ds);
    meanD = m && m.n > 1 ? m.mean : null;
    $('#mMeanRow').hidden = meanD === null;
    if (meanD !== null) $('#mMean').textContent = t('mMean', m.n, m.mean.toFixed(1), m.spread.toFixed(1));
    compassD = relativeDeclination(state.lat, norm180((Number($('#mBearing').value) || 0) + (Number($('#mMagDecl').value) || 0) - 180));
    $('#mCompassOut').textContent = `${compassD.toFixed(1)}°`;
  };
  for (const id of ['#mDate', '#mTime', '#mBeta', '#mBearing', '#mMagDecl']) $(id).addEventListener('input', calc);
  $('#mShadowApply').addEventListener('click', () => { if (shadowD !== null) { state.D = Math.round(shadowD * 10) / 10; update(); } });
  $('#mAdd').addEventListener('click', () => {
    // only the validated fields are kept (they are shown again in the list)
    const date = $('#mDate').value, time = $('#mTime').value, beta = Number($('#mBeta').value) || 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && fromReading(date, time, beta)?.D != null) { readings.push({ date, time, beta }); calc(); }
  });
  $('#mReadings').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { readings.splice(Number(b.dataset.rm), 1); calc(); } });
  $('#mMeanApply').addEventListener('click', () => { if (meanD !== null) { state.D = Math.round(meanD * 10) / 10; update(); } });
  // the phone's compass: average 3 seconds of headings (lying flat, top pointing away from the wall) into the bearing field
  $('#mPhone').addEventListener('click', async () => {
    const out = $('#mPhoneOut');
    const DO = window.DeviceOrientationEvent;
    if (!DO) { out.textContent = t('mPhoneNone'); return; }
    if (typeof DO.requestPermission === 'function') { // iOS asks first
      try { if (await DO.requestPermission() !== 'granted') { out.textContent = t('mPhoneDenied'); return; } } catch { out.textContent = t('mPhoneDenied'); return; }
    }
    const got = [];
    const on = (e) => { const h = compassHeading(e); if (h !== null) { got.push(h); out.textContent = t('mPhoneWait', got.length); } };
    const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(type, on);
    out.textContent = t('mPhoneWait', 0);
    setTimeout(() => {
      window.removeEventListener(type, on);
      const m = circularMean(got);
      if (!m) { out.textContent = t('mPhoneNone'); return; }
      const bearing = Math.round(((m.mean + 360) % 360) * 10) / 10;
      $('#mBearing').value = bearing;
      out.textContent = t('mPhoneDone', bearing.toFixed(1), m.spread.toFixed(1), m.n);
      calc();
    }, 3000);
  });
  $('#mCompassApply').addEventListener('click', () => { state.D = Math.round(compassD * 10) / 10; update(); });
  // the shadow result depends on lat/lon/tz/dst: without this it kept the old place's value after a change
  refreshMeasure = calc;
  calc();
}

// ---------------- downloads ----------------
function ctx() {
  return { s: state, t, place: PRESETS[state.place]?.name || '', dateStr: new Date().toISOString().slice(0, 10) };
}
function base() {
  return `sundial-${state.place}-D${state.D}`;
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const tileOpts = () => ({ orient: state.orient, margin: state.printMargin, t });
// everything to print: the dial's pages, then the gnomon template, the info sheet and the chart (each normally one page)
function printJob() {
  const c = ctx(), nm = PRESETS[state.place]?.name || '';
  return [[faceSheet(dial, c), `${t('sheetFace')} ${nm}`], [gnomonSheetFor(dial, c, state.paper, { ...tileOpts(), overlap: state.overlap }), t('sheetGnomon')], [infoSheet(dial, c), t('sheetInfo')], [correctionSheet(dial, c), t('sheetCorr')]];
}
// only the page grid is computed here; the SVGs are built when a button is clicked
function updateTiles() {
  const box = $('#tiles'), info = $('#printInfo');
  const none = state.paper === 'none';
  $('#fitPage').disabled = none;
  for (const k of ['overlap', 'orient', 'printMargin']) $(`[data-k="${k}"]`).disabled = none; // they only matter with a paper size
  if (none) { info.textContent = t('printNone'); box.innerHTML = ''; return; }
  const { W, H } = faceSheetSize(dial, state);
  const lay = tileLayout(W, H, state.paper, state.overlap, tileOpts());
  if (!lay) { info.textContent = t('printTooSmall'); box.innerHTML = ''; return; }
  const oname = (o) => t(o === 'portrait' ? 'orientPortrait' : 'orientLandscape');
  let msg = lay.pages === 1 ? t('printOne', state.paper, oname(lay.orient)) : t('printMany', state.paper, oname(lay.orient), lay.nx, lay.ny, lay.pages);
  if (state.orient !== 'auto') { // a forced orientation can cost pages: say so
    const best = tileLayout(W, H, state.paper, state.overlap, { margin: state.printMargin });
    if (best && best.pages < lay.pages) msg += t('printBetter', oname(best.orient), best.pages);
  }
  const save = tileSavings(W, H, lay); // a small trim that removes a whole row or column of pages
  if (save) msg += t('printTrim', save.mm.toFixed(1), t(save.axis === 'W' ? 'trimNarrow' : 'trimLow'), save.pages);
  const lots = lay.pages > MAX_QUIET_PAGES;
  if (lots) msg += t('printLots');
  info.textContent = msg;
  const btns = [];
  if (!lots) for (let j = 0; j < lay.ny; j++) for (let i = 0; i < lay.nx; i++) btns.push(`<button type="button" data-tile="${btns.length}">${tileName('', i, j).slice(1)}</button>`); // no row of hundreds of buttons
  box.innerHTML = `${btns.length ? `<span>${t('tilesFor')} (${btns.length}):</span>${btns.join('')}` : ''}<button type="button" id="printTiles">${t('printTiles')}</button>`;
}
function bindDownloads() {
  $('#fitPage').addEventListener('click', () => {
    const fit = fitPlateToPage(state, t, state.paper, tileOpts());
    if (!fit) { inputWarnings.push(['fitPageNo']); update(); return; }
    Object.assign(state, fit);
    // then, if asked, the biggest gnomon that is one page too: only the multiplier changes, never the dial
    const fitted = sanitize(state).s;
    if (state.fitGnomonX && !(fitted.rodTip && clockOn(fitted)) && rodXApplies(fitted, buildDial(fitted, t))) {
      const k = fitGnomonScale(fitted, t, state.paper, tileOpts());
      if (k) state.rodX = k; else inputWarnings.push(['fitGnomonNo']);
    }
    update();
  });
  $('#dlFace').addEventListener('click', () => download(`${base()}-face.svg`, svgDoc(faceSheet(dial, ctx()))));
  $('#dlGnomon').addEventListener('click', () => download(`${base()}-gnomon.svg`, svgDoc(gnomonSheetFor(dial, ctx(), state.paper, { ...tileOpts(), overlap: state.overlap }))));
  $('#dlInfo').addEventListener('click', () => download(`${base()}-info.svg`, svgDoc(infoSheet(dial, ctx()))));
  $('#dlCorr').addEventListener('click', () => download(`${base()}-correction.svg`, svgDoc(correctionSheet(dial, ctx()))));
  // the shadow test sheet is for the date shown in the Time controls
  $('#dlTest').addEventListener('click', () => {
    const c = civilFromUtc(time.ms, state.tz, state.dst);
    const dateText = `${c.d} ${t('monthsShort')[c.mo]} ${c.y}`;
    const summer = state.dst !== 'none' && isDst(Date.UTC(c.y, c.mo, c.d, 12 - state.tz), state.tz, state.dst); // that year's change dates
    download(`${base()}-test-${c.y}-${pad2(c.mo + 1)}-${pad2(c.d)}.svg`, svgDoc(testSheet(dial, { ...ctx(), day: dayOfYear(c.mo, c.d), dateText, summer })));
  });
  $('#tiles').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'printTiles') {
      const job = printJob(), n = printJobPages(job, state.paper, state.overlap, tileOpts());
      if (!n) return;
      if (n > MAX_QUIET_PAGES && !confirm(t('printConfirm', n))) return;
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(printJobHtml(job, state.paper, state.overlap, tileOpts(), `${base()} ${t('tilesFor')}`));
      w.document.close();
      return;
    }
    if (state.paper === 'none' || b.dataset.tile === undefined) return;
    // only the page that was asked for is built (not every page of the sheet)
    const [tl] = tileSheets(faceSheet(dial, ctx()), state.paper, state.overlap, `${t('sheetFace')} ${PRESETS[state.place]?.name || ''}`, { ...tileOpts(), only: Number(b.dataset.tile) });
    if (tl) download(`${base()}-${tl.name}.svg`, tl.svg);
  });
}

// ---------------- init ----------------
function init() {
  applyLang();
  $('#controls').addEventListener('input', (e) => { if (e.target.matches('input[type="range"][data-k], input[type="text"][data-k]')) onControl(e); });
  $('#controls').addEventListener('change', (e) => { if (e.target.matches('[data-k]')) onControl(e); });
  $('#wallPreset').addEventListener('change', (e) => { if (e.target.value !== '') { state.D = Number(e.target.value); update(); } });
  for (const b of $$('[data-lang-btn]')) b.addEventListener('click', () => { state.lang = b.dataset.langBtn; applyLang(); update(); });
  $('#geo').addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      const jan = -new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset() / 60;
      const jul = -new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset() / 60;
      const lon = +pos.coords.longitude.toFixed(4);
      // the browser's January/July offsets tell whether (and in which hemisphere) summer time applies
      const dst = jan === jul ? 'none' : jul > jan ? (lon < -30 ? 'US' : 'EU') : 'AU';
      Object.assign(state, { place: 'custom', lat: +pos.coords.latitude.toFixed(4), lon, tz: Math.min(jan, jul), dst });
      update();
    }, (err) => alert(err.message));
  });
  window.addEventListener('hashchange', () => {
    if (new URLSearchParams(location.hash.slice(1)).toString() !== serializeState(state)) { state = loadState(); applyLang(); update(); }
  });
  bindTime();
  bindMeasure();
  bindDownloads();
  bindSunHover();
  update();
  requestAnimationFrame(tick);
}
init();
