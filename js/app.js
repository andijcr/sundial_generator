// UI wiring: state <-> controls, rendering, time loop, downloads.

import { sunAt, civilFromUtc, utcFromCivil, norm180, fmtHM, lonCorrection } from './astro.js';
import { shadowPoint } from './dial.js';
import { frontViewSvg, shadowMarkup, trailMarkup, faceSheet, faceSheetSize, gnomonSheet, infoSheet, svgDoc, tileSheets, tileLayout, tileName } from './svg.js';
import { DEFAULTS, PRESETS, WALL_PRESETS, sanitize, buildDial, serializeState, dstLabelsApply } from './state.js';
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
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const b of $$('[data-lang-btn]')) b.setAttribute('aria-pressed', String(b.dataset.langBtn === state.lang));
  fillSelects();
}
function fillSelects() {
  const place = $('#place');
  place.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('') + `<option value="custom">${t('custom')}</option>`;
  place.value = state.place;
  const wp = $('#wallPreset');
  const dirs = t('dirs');
  wp.innerHTML = `<option value="">${t('custom')}</option>` + Object.entries(WALL_PRESETS).map(([k, d]) => `<option value="${k}">${dirs[k] || k} (D = ${d}°)</option>`).join('');
  syncWallPreset();
}
function syncWallPreset() {
  const k = Object.entries(WALL_PRESETS).find(([, d]) => Math.abs(d - state.D) < 1e-6);
  $('#wallPreset').value = k ? k[0] : '';
}

// ---------------- controls ----------------
function writeControls() {
  for (const el of $$('[data-k]')) {
    const k = el.dataset.k;
    if (k === 'place') continue;
    let v = state[k];
    if (state.auto && dial && (k === 'L' || k === 'fx' || k === 'fy')) v = k === 'L' ? dial.L : dial.plate[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = typeof v === 'number' ? +v.toFixed(4) : v;
  }
  for (const el of $$('.manual')) el.disabled = state.auto;
  $('[data-k="hExtend"]').disabled = !state.gPolar; // the style root only exists for the triangular style
  $('[data-k="hDstLabels"]').disabled = !dstLabelsApply(state); // needs lines that read clock time
  $('#facesAz').textContent = `${((180 + state.D + 360) % 360).toFixed(1)}° (N→E)`;
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
    if (k === 'hQuarter' && v) state.hHalf = true;
  }
  update();
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
  syncWallPreset();
  writeControls();
  const all = [...warns, ...dial.warnings];
  $('#warnings').innerHTML = all.map(([k, ...a]) => `<li>⚠ ${t('w_' + k, ...a)}</li>`).join('');
  updateLearn();
  updateTiles();
  time.trail = [];
  saveHash();
  renderTime();
}

function updateLearn() {
  const a = dial.angles;
  const subH = 12 + a.DL / 15;
  const v = {
    D: `${state.D.toFixed(1)}°`, L: `${dial.L.toFixed(0)} mm`,
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
  if (ae !== $('#tDate')) $('#tDate').value = `${c.y}-${pad2(c.mo + 1)}-${pad2(c.d)}`;
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
  const S = shadowPoint(sun.vec, dial.L, dial.frame);
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
    view3d.setScene({ dial, sun: sun.vec, decl: sun.decl, lat: state.lat, S, D: state.D, gPolar: state.gPolar, gRod: state.gRod, gBlade: state.gBlade, trail: time.trailOn ? time.trail : [] });
  }
  // readout
  const lit = sun.alt > 0 && S;
  const status = sun.alt <= 0 ? t('rNight') : lit ? t('rOnWall') : t('rBehind');
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
function bindMeasure() {
  const now = civilFromUtc(Date.now(), state.tz, state.dst);
  $('#mDate').value = `${now.y}-${pad2(now.mo + 1)}-${pad2(now.d)}`;
  $('#mTime').value = `${pad2(now.h)}:${pad2(now.mi)}`;
  let shadowD = null, compassD = null;
  const calc = () => {
    const [y, mo, d] = ($('#mDate').value || '').split('-').map(Number);
    const [h, mi] = ($('#mTime').value || '').split(':').map(Number);
    const beta = Number($('#mBeta').value) || 0;
    if ([y, mo, d, h, mi].every(Number.isFinite)) {
      const sun = sunAt(utcFromCivil(y, mo - 1, d, h, mi, state.tz, state.dst), state.lat, state.lon);
      shadowD = sun.alt > 0 ? norm180(sun.az - 180 - beta) : null;
      $('#mShadowOut').textContent = shadowD === null ? '— (sun below horizon)' : `${shadowD.toFixed(1)}°  (sun az ${sun.az.toFixed(1)}°)`;
    }
    compassD = norm180((Number($('#mBearing').value) || 0) + (Number($('#mMagDecl').value) || 0) - 180);
    $('#mCompassOut').textContent = `${compassD.toFixed(1)}°`;
  };
  for (const id of ['#mDate', '#mTime', '#mBeta', '#mBearing', '#mMagDecl']) $(id).addEventListener('input', calc);
  $('#mShadowApply').addEventListener('click', () => { if (shadowD !== null) { state.D = Math.round(shadowD * 10) / 10; update(); } });
  $('#mCompassApply').addEventListener('click', () => { state.D = Math.round(compassD * 10) / 10; update(); });
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
function currentTiles() {
  if (state.paper === 'none') return [];
  return tileSheets(faceSheet(dial, ctx()), state.paper, state.overlap, `${t('sheetFace')} ${PRESETS[state.place]?.name || ''}`);
}
// only the page grid is computed here; the SVGs are built when a button is clicked
function updateTiles() {
  const box = $('#tiles');
  const { W, H } = faceSheetSize(dial);
  const lay = tileLayout(W, H, state.paper, state.overlap);
  if (!lay) { box.innerHTML = ''; return; }
  const btns = [];
  for (let j = 0; j < lay.ny; j++) for (let i = 0; i < lay.nx; i++) btns.push(`<button type="button" data-tile="${btns.length}">${tileName('', i, j).slice(1)}</button>`);
  box.innerHTML = `<span>${t('tilesFor')} (${btns.length}):</span>${btns.join('')}<button type="button" id="printTiles">${t('printTiles')}</button>`;
}
function bindDownloads() {
  $('#dlFace').addEventListener('click', () => download(`${base()}-face.svg`, svgDoc(faceSheet(dial, ctx()))));
  $('#dlGnomon').addEventListener('click', () => download(`${base()}-gnomon.svg`, svgDoc(gnomonSheet(dial, ctx()))));
  $('#dlInfo').addEventListener('click', () => download(`${base()}-info.svg`, svgDoc(infoSheet(dial, ctx()))));
  $('#tiles').addEventListener('click', (e) => {
    const tiles = currentTiles();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'printTiles') {
      const w = window.open('', '_blank');
      if (!w) return;
      const { pw, ph } = tiles[0];
      w.document.write(`<!doctype html><title>${esc(base())} pages</title><style>@page{size:${pw}mm ${ph}mm;margin:0}body{margin:0}.pg{width:${pw}mm;height:${ph}mm;break-after:page;overflow:hidden}.pg svg{display:block;width:${pw}mm;height:${ph}mm}</style>` +
        tiles.map((tl) => `<div class="pg">${tl.svg.replace(/^<\?xml[^>]*>\s*/, '')}</div>`).join('') + '<script>onload=()=>print()<\/script>');
      w.document.close();
      return;
    }
    const tl = tiles[Number(b.dataset.tile)];
    if (tl) download(`${base()}-${tl.name}.svg`, tl.svg);
  });
}

// ---------------- init ----------------
function init() {
  applyLang();
  $('#controls').addEventListener('input', (e) => { if (e.target.matches('input[type="range"][data-k], input[type="text"][data-k]')) onControl(e); });
  $('#controls').addEventListener('change', (e) => { if (e.target.matches('[data-k]')) onControl(e); });
  $('#wallPreset').addEventListener('change', (e) => { if (e.target.value in WALL_PRESETS) { state.D = WALL_PRESETS[e.target.value]; update(); } });
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
  update();
  requestAnimationFrame(tick);
}
init();
