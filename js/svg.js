// SVG builders: interactive front view, printable sheets (face, gnomon, info)
// and page tiling. Pure string generation, no DOM, so Node can run it too.
//
// Sheet units: 1 user unit = 1 mm (width/height are given in "mm").

import { solarParams, dayMs, isDst, REF_YEAR, fmtHM, lonCorrection } from './astro.js';

const f = (n) => String(Math.round(n * 100) / 100);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const MATERIALS = { paper: { sw: 0.35, font: 5 }, tile: { sw: 1.0, font: 8 }, laser: { sw: 0.1, font: 5 } };

/** Font size (mm) and base stroke width (mm) for a material and plate size. */
export function sizesFor(material, plate) {
  const k = clamp(Math.min(plate.w, plate.h) / 450, 0.5, 4);
  const m = MATERIALS[material] || MATERIALS.paper;
  return { fs: m.font * k, sw: material === 'laser' ? 0.1 : m.sw * k };
}

// [colour, width multiplier, dash pattern (in multiples of 4·sw)]
const LSTYLE = {
  hour: ['#1b1b1b', 1.6], hourMinor: ['#1b1b1b', 0.7], hourExt: ['#1b1b1b', 0.5, '2 1.5'],
  zone: ['#1f5fa8', 1.4], zoneMinor: ['#1f5fa8', 0.6], zoneExt: ['#1f5fa8', 0.5, '2 1.5'],
  anaR: ['#c0392b', 1], anaF: ['#c0392b', 1, '3 1.5'], tick: ['#c0392b', 1],
  date: ['#2a7f62', 1.1], dateMinor: ['#2a7f62', 0.6, '4 1.5'],
  ital: ['#8e44ad', 0.8], bab: ['#d35400', 0.8],
  az: ['#7a7a7a', 0.6, '1 1.5'], alt: ['#7a7a7a', 0.6, '1 1.5'],
  construct: ['#9a9a9a', 0.6, '6 2 1 2'],
};
const TCOLOR = { hour: '#1b1b1b', zone: '#1f5fa8', dst: '#a0700b', ana: '#c0392b', date: '#2a7f62', dateMinor: '#2a7f62', ital: '#8e44ad', bab: '#d35400', az: '#666', alt: '#666' };

export function dialCss(material, sw) {
  const laser = material === 'laser';
  let css = laser
    ? `.plate{fill:none;stroke:#f00;stroke-width:0.1}`
    : `.plate{fill:#fbf6ea;stroke:#3b3b3b;stroke-width:${f(sw * 2)}}`;
  for (const [k, [c, w, dash]] of Object.entries(LSTYLE)) {
    css += `.l-${k}{fill:none;stroke:${laser ? '#000' : c};stroke-width:${f(laser ? 0.1 : sw * w)};stroke-linecap:round;stroke-linejoin:round${dash && !laser ? `;stroke-dasharray:${dash.split(' ').map((d) => f(d * sw * 4)).join(' ')}` : ''}}`;
  }
  css += `.t{font-family:${material === 'tile' ? 'Georgia,serif' : 'Helvetica,Arial,sans-serif'};text-anchor:middle;dominant-baseline:central}`;
  for (const [k, c] of Object.entries(TCOLOR)) css += `.t-${k}{fill:${laser ? '#000' : c}}`;
  css += `.mark{fill:none;stroke:${laser ? '#000' : '#333'};stroke-width:${f(laser ? 0.1 : sw * 1.2)}}`;
  css += `.info{fill:${laser ? '#000' : '#555'};font-family:Helvetica,Arial,sans-serif}.motto{fill:${laser ? '#000' : '#333'};font-family:Georgia,serif;font-style:italic;text-anchor:middle}`;
  return css;
}

const SHEET_CSS = `.dim{stroke:#444;stroke-width:0.25;fill:none}.dimx{stroke:#444;stroke-width:0.18;fill:none}
.dt{font-family:Helvetica,Arial,sans-serif;font-size:3.5px;fill:#222;text-anchor:middle}
.st{font-family:Helvetica,Arial,sans-serif;fill:#222}.sb{font-weight:bold}
.cut{fill:#f3efe4;stroke:#000;stroke-width:0.35}.fold{stroke:#000;stroke-width:0.3;stroke-dasharray:3 2;fill:none}
.reg{stroke:#000;stroke-width:0.2;fill:none}.tileb{stroke:#999;stroke-width:0.2;stroke-dasharray:2 2;fill:none}`;

const DEFS = `<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="#444"/></marker></defs>`;

function pathD(lines, P) {
  return lines.map((l) => 'M' + l.map(([x, y]) => f(P.fx + x) + ' ' + f(P.fy - y)).join('L')).join('');
}

/** Markup of the plate and all marks, in plate coordinates (0..w, 0..h). */
export function dialMarkup(dial, ctx) {
  const P = dial.plate, fs = dial.fontSize, s = ctx.s;
  let out = `<rect class="plate" x="0" y="0" width="${f(P.w)}" height="${f(P.h)}" rx="${f(Math.min(P.w, P.h) * 0.01)}"/>`;
  for (const layer of dial.layers) {
    if (layer.lines.length) out += `<path class="l-${layer.cls}" d="${pathD(layer.lines, P)}"/>`;
  }
  for (const layer of dial.layers) {
    for (const lb of layer.labels) {
      out += `<text class="t t-${lb.cls}" x="${f(P.fx + lb.x)}" y="${f(P.fy - lb.y)}" font-size="${f(fs * (lb.size || 1))}">${esc(lb.text)}</text>`;
    }
  }
  // gnomon foot (cross) and style root (circle)
  const c = fs * 0.5;
  out += `<path class="mark" d="M${f(P.fx - c)} ${f(P.fy)}H${f(P.fx + c)}M${f(P.fx)} ${f(P.fy - c)}V${f(P.fy + c)}"/>`;
  if (dial.root && s.gPolar) {
    out += `<circle class="mark" cx="${f(P.fx + dial.root[0])}" cy="${f(P.fy - dial.root[1])}" r="${f(fs * 0.25)}"/>`;
  }
  const yb = P.h - P.margin - fs * 0.6;
  if (s.xInfo) {
    const txt = `${Math.abs(s.lat).toFixed(2)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(2)}°${s.lon >= 0 ? 'E' : 'W'} · D ${s.D.toFixed(1)}° · L ${dial.L.toFixed(0)} mm`;
    out += `<text class="info" x="${f(P.margin + fs * 0.2)}" y="${f(yb)}" font-size="${f(fs * 0.5)}" dominant-baseline="central">${esc(txt)}</text>`;
  }
  if (s.motto) {
    out += `<text class="motto" x="${f(P.w / 2)}" y="${f(yb)}" font-size="${f(fs * 0.95)}" dominant-baseline="central">${esc(s.motto)}</text>`;
  }
  return out;
}

// ---------------- Interactive front view ----------------

export function frontViewSvg(dial, ctx) {
  const P = dial.plate;
  const pad = 0.1 * Math.max(P.w, P.h);
  const { sw } = sizesFor(ctx.s.material, P);
  let g = '';
  if (dial.root && ctx.s.gPolar) {
    g += `<line x1="${f(P.fx + dial.root[0])}" y1="${f(P.fy - dial.root[1])}" x2="${f(P.fx)}" y2="${f(P.fy)}" stroke="#2b2b2b" stroke-width="${f(Math.max(sw * 5, 2))}" stroke-linecap="round"/>`;
  }
  if (ctx.s.gRod) g += `<circle cx="${f(P.fx)}" cy="${f(P.fy)}" r="${f(dial.fontSize * 0.35)}" fill="#2b2b2b"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-pad)} ${f(-pad)} ${f(P.w + 2 * pad)} ${f(P.h + 2 * pad)}" role="img">
<style>${dialCss(ctx.s.material === 'laser' ? 'paper' : ctx.s.material, sw)}</style>
<defs><pattern id="bricks" width="60" height="30" patternUnits="userSpaceOnUse"><rect width="60" height="30" fill="#d9c7a7"/><path d="M0 0H60M0 15H60M30 0V15M0 15V30M60 15V30" stroke="#c7b28e" stroke-width="1"/></pattern>
<clipPath id="wallclip"><rect x="${f(-pad)}" y="${f(-pad)}" width="${f(P.w + 2 * pad)}" height="${f(P.h + 2 * pad)}"/></clipPath></defs>
<rect x="${f(-pad)}" y="${f(-pad)}" width="${f(P.w + 2 * pad)}" height="${f(P.h + 2 * pad)}" fill="url(#bricks)"/>
<g>${dialMarkup(dial, ctx)}</g>
<g clip-path="url(#wallclip)"><g id="trail"></g><g id="shadow"></g></g>
<g>${g}</g></svg>`;
}

/** Shadow overlay for nodus shadow point S (dial coords) or null. */
export function shadowMarkup(dial, ctx, S, trail) {
  const P = dial.plate, fs = dial.fontSize;
  const X = (p) => f(P.fx + p[0]), Y = (p) => f(P.fy - p[1]);
  let out = '';
  if (S) {
    const big = 30 * Math.max(P.w, P.h);
    const n = Math.hypot(S[0], S[1]);
    // keep huge (grazing) shadows drawable
    const Sc = n > big ? [S[0] / n * big, S[1] / n * big] : S;
    if (ctx.s.gPolar && dial.root) {
      out += `<polygon points="${X(dial.root)},${Y(dial.root)} ${X([0, 0])},${Y([0, 0])} ${X(Sc)},${Y(Sc)}" fill="rgba(20,20,30,0.38)"/>`;
    }
    if (ctx.s.gRod) {
      out += `<line x1="${X([0, 0])}" y1="${Y([0, 0])}" x2="${X(Sc)}" y2="${Y(Sc)}" stroke="rgba(20,20,30,0.45)" stroke-width="${f(Math.max(dial.L * 0.025, 1.5))}" stroke-linecap="round"/>`;
    }
    if (n <= big) {
      out += `<circle cx="${X(S)}" cy="${Y(S)}" r="${f(fs * 0.35)}" fill="rgba(20,20,30,0.75)"/>`;
      out += `<circle cx="${X(S)}" cy="${Y(S)}" r="${f(fs * 0.8)}" fill="none" stroke="#e4572e" stroke-width="${f(fs * 0.12)}"/>`;
    }
  }
  return out;
}
export function trailMarkup(dial, pts) {
  if (pts.length < 2) return '';
  const P = dial.plate;
  return `<path d="M${pts.map((p) => f(P.fx + p[0]) + ' ' + f(P.fy - p[1])).join('L')}" fill="none" stroke="#e4572e" stroke-width="${f(dial.fontSize * 0.12)}" stroke-opacity="0.8"/>`;
}

// ---------------- Print sheets ----------------

export function svgDoc(sheet) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(sheet.W)}mm" height="${f(sheet.H)}mm" viewBox="0 0 ${f(sheet.W)} ${f(sheet.H)}">
${DEFS}<style>${sheet.css}${SHEET_CSS}</style>
<rect x="0" y="0" width="${f(sheet.W)}" height="${f(sheet.H)}" fill="#fff"/>
${sheet.inner}
</svg>`;
}

function dimH(x1, x2, y, yRef, text) {
  return `<path class="dimx" d="M${f(x1)} ${f(yRef)}V${f(y + Math.sign(y - yRef) * 2)}M${f(x2)} ${f(yRef)}V${f(y + Math.sign(y - yRef) * 2)}"/>` +
    `<path class="dim" d="M${f(x1)} ${f(y)}H${f(x2)}" marker-start="url(#arr)" marker-end="url(#arr)"/>` +
    (Math.abs(x2 - x1) > 28
      ? `<text class="dt" x="${f((x1 + x2) / 2)}" y="${f(y - 1.2)}">${esc(text)}</text>`
      : `<text class="dt" x="${f(Math.max(x1, x2) + 2)}" y="${f(y + 1.2)}" style="text-anchor:start">${esc(text)}</text>`);
}
function dimV(y1, y2, x, xRef, text) {
  const cx = x, cy = (y1 + y2) / 2;
  return `<path class="dimx" d="M${f(xRef)} ${f(y1)}H${f(x + Math.sign(x - xRef) * 2)}M${f(xRef)} ${f(y2)}H${f(x + Math.sign(x - xRef) * 2)}"/>` +
    `<path class="dim" d="M${f(x)} ${f(y1)}V${f(y2)}" marker-start="url(#arr)" marker-end="url(#arr)"/>` +
    (Math.abs(y2 - y1) > 28
      ? `<text class="dt" x="${f(cx - 1.2)}" y="${f(cy)}" transform="rotate(-90 ${f(cx - 1.2)} ${f(cy)})">${esc(text)}</text>`
      : `<text class="dt" x="${f(cx + 1.5)}" y="${f(Math.max(y1, y2) + 4.5)}" style="text-anchor:start">${esc(text)}</text>`);
}
const mm = (x) => `${x.toFixed(1)} mm`;

function textLines(x, y, lines, size, gap = 1.45) {
  return lines.map((l, i) => {
    const bold = typeof l === 'object' && l.b;
    const txt = typeof l === 'object' ? l.t : l;
    return `<text class="st${bold ? ' sb' : ''}" x="${f(x)}" y="${f(y + i * size * gap)}" font-size="${f(size)}">${esc(txt)}</text>`;
  }).join('');
}

function summaryLines(dial, ctx) {
  const { s, t } = ctx;
  const a = dial.angles;
  const systems = [s.hSolar && t('hSolar'), s.hZone && t('hZone'), s.anaMeanNoon && t('anaMeanNoon'), (s.anaZoneNoon || s.anaHours) && (s.anaHours ? t('anaHours') : t('anaZoneNoon'))].filter(Boolean).join(' · ');
  return [
    `${ctx.place ? ctx.place + ' — ' : ''}${Math.abs(s.lat).toFixed(4)}° ${s.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.lon).toFixed(4)}° ${s.lon >= 0 ? 'E' : 'W'}, UTC${s.tz >= 0 ? '+' : ''}${s.tz} (${s.dst})`,
    `D = ${s.D.toFixed(1)}° (${t('faces')} ${((180 + s.D + 360) % 360).toFixed(1)}° N→E) · L = ${mm(dial.L)} · ${dial.plate.w.toFixed(0)} × ${dial.plate.h.toFixed(0)} mm`,
    `${t('SH')} ${a.SH.toFixed(2)}° · ${t('SD')} ${a.SD.toFixed(2)}° · ${t('DL')} ${a.DL.toFixed(2)}°`,
    systems,
  ];
}

const FACE_M = { L: 40, T: 35, R: 40, B: 80 };
/** Size of the face sheet in mm, without rendering it. */
export function faceSheetSize(dial) {
  return { W: dial.plate.w + FACE_M.L + FACE_M.R, H: dial.plate.h + FACE_M.T + FACE_M.B };
}

export function faceSheet(dial, ctx) {
  const { s, t } = ctx;
  const P = dial.plate;
  const { sw } = sizesFor(s.material, P);
  const { L: ML, T: MT, R: MR } = FACE_M;
  const { W, H } = faceSheetSize(dial);
  let g = dialMarkup(dial, ctx);
  if (s.material !== 'laser') {
    g += `<path class="l-construct" d="M${f(P.fx)} 0V${f(P.h)}"/>`;
    g += `<text class="dt" x="${f(P.fx + 2.5)}" y="${f(P.h * 0.04 + 10)}" transform="rotate(-90 ${f(P.fx + 2.5)} ${f(P.h * 0.04 + 10)})" style="text-anchor:end">${esc(t('plumb'))}</text>`;
    g += `<text class="dt" x="${f(P.fx - 3)}" y="${f(P.fy - 3)}" style="text-anchor:end">F</text>`;
  }
  // dimensions
  g += dimH(0, P.w, -14, 0, mm(P.w));
  g += dimV(0, P.h, -14, 0, mm(P.h));
  g += dimH(0, P.fx, P.h + 12, P.h, `F ${mm(P.fx)}`);
  g += dimV(0, P.fy, P.w + 12, P.w, `F ${mm(P.fy)}`);
  if (dial.root && s.gPolar) {
    const rx = P.fx + dial.root[0], ry = P.fy - dial.root[1];
    if (s.material !== 'laser') g += `<text class="dt" x="${f(rx + 3)}" y="${f(ry - 3)}" style="text-anchor:start">R</text>`;
    g += dimH(0, rx, P.h + 22, P.h, `R ${mm(rx)}`);
    g += dimV(0, ry, P.w + 24, P.w, `R ${mm(ry)}`);
  }
  let inner = `<g transform="translate(${ML},${MT})">${g}</g>`;
  // title block
  const ty = MT + P.h + 36;
  inner += textLines(ML, ty, [{ t: `${t('title')} — ${t('sheetFace')}`, b: true }, ...summaryLines(dial, ctx),
    `F: ${t('foot').replace(/^F: /, '')}${dial.root && s.gPolar ? ` · R: ${t('root').replace(/^R: /, '')} (${dial.root[0].toFixed(1)}, ${dial.root[1].toFixed(1)}) mm` : ''}`,
    `${t('generated')}: ${ctx.dateStr || ''}`], 3.6);
  // 100 mm scale bar
  const sx = W - MR - 100, sy = H - 14;
  let bar = `<path class="dim" d="M${sx} ${sy}H${sx + 100}"/>`;
  for (let i = 0; i <= 10; i++) bar += `<path class="dim" d="M${sx + i * 10} ${sy}V${sy - (i % 5 === 0 ? 4 : 2)}"/>`;
  bar += `<text class="dt" x="${sx}" y="${sy - 5.5}">0</text><text class="dt" x="${sx + 50}" y="${sy - 5.5}">50</text><text class="dt" x="${sx + 100}" y="${sy - 5.5}">100 mm</text>`;
  bar += `<text class="dt" x="${sx + 50}" y="${sy + 5}">${esc(t('scale'))}</text>`;
  inner += bar;
  return { W, H, inner, css: dialCss(s.material, sw), name: 'face' };
}

export function gnomonSheet(dial, ctx) {
  const { s, t } = ctx;
  const L = dial.L, M = 25, TAB = 15;
  let inner = '', x = M, H = 0;
  const top = M + 12;
  inner += textLines(M, M, [{ t: `${t('title')} — ${t('sheetGnomon')}`, b: true }], 5);
  if (s.gPolar && dial.root) {
    const a = Math.hypot(dial.root[0], dial.root[1]);
    const hyp = Math.hypot(a, L);
    const SH = Math.atan2(L, a) * 180 / Math.PI;
    const ox = x, oy = top + L + 10; // R' at (ox, oy)
    const tb = Math.min(TAB, a / 4);
    let g = `<polygon class="cut" points="${f(ox)},${f(oy)} ${f(ox + a)},${f(oy)} ${f(ox + a)},${f(oy - L)}"/>`;
    g += `<polygon class="cut" points="${f(ox)},${f(oy)} ${f(ox + a)},${f(oy)} ${f(ox + a - tb)},${f(oy + tb)} ${f(ox + tb)},${f(oy + tb)}"/>`;
    g += `<path class="fold" d="M${f(ox)} ${f(oy)}H${f(ox + a)}"/>`;
    const r = Math.min(a, L, 60) * 0.35;
    g += `<path class="dim" d="M${f(ox + r)} ${f(oy)}A${f(r)} ${f(r)} 0 0 0 ${f(ox + r * Math.cos(SH * Math.PI / 180))} ${f(oy - r * Math.sin(SH * Math.PI / 180))}"/>`;
    g += `<text class="dt" x="${f(ox + r + 6)}" y="${f(oy - 2)}" style="text-anchor:start">${SH.toFixed(2)}°</text>`;
    g += dimH(ox, ox + a, oy + tb + 9, oy + tb, mm(a));
    g += dimV(oy - L, oy, ox + a + 10, ox + a, `L = ${mm(L)}`);
    const mx = ox + a / 2, my = oy - L / 2, ang = -SH;
    g += `<text class="dt" x="${f(mx - 3)}" y="${f(my - 3)}" transform="rotate(${f(ang)} ${f(mx - 3)} ${f(my - 3)})">${esc(t('styleEdge'))} — ${mm(hyp)}</text>`;
    g += `<text class="dt" x="${f(ox - 3)}" y="${f(oy + 1)}" style="text-anchor:end">R</text>`;
    g += `<text class="dt" x="${f(ox + a + 3)}" y="${f(oy + 4)}" style="text-anchor:start">F</text>`;
    g += `<text class="dt" x="${f(ox + a + 3)}" y="${f(oy - L - 2)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    g += `<circle cx="${f(ox + a)}" cy="${f(oy - L)}" r="1" fill="#c0392b"/>`;
    g += `<text class="dt" x="${f(ox + a / 2)}" y="${f(oy + tb / 2 + 1)}">${esc(t('tab'))}</text>`;
    g += `<text class="dt" x="${f(ox + a / 2)}" y="${f(oy + tb + 20)}">${esc(t('wallEdge'))}</text>`;
    inner += g;
    x += a + 45;
    H = Math.max(H, oy + tb + 30);
  } else if (s.gPolar) {
    inner += textLines(M, top + 8, [t('noPolar')], 4);
    H = Math.max(H, top + 20);
  }
  if (s.gRod || !dial.root) {
    const EMB = 30, ox = x + 10, oy = top + 10;
    let g = `<rect class="cut" x="${f(ox - 2)}" y="${f(oy)}" width="4" height="${f(L + EMB)}"/>`;
    g += `<path class="fold" d="M${f(ox - 10)} ${f(oy + L)}H${f(ox + 10)}"/>`;
    g += `<circle cx="${f(ox)}" cy="${f(oy)}" r="1.2" fill="#c0392b"/>`;
    g += dimV(oy, oy + L, ox + 14, ox + 2, `L = ${mm(L)}`);
    g += `<text class="dt" x="${f(ox + 6)}" y="${f(oy + L + EMB / 2)}" style="text-anchor:start">${EMB} mm ${esc(t('rodEmbed'))}</text>`;
    g += `<text class="dt" x="${f(ox + 6)}" y="${f(oy - 3)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    g += `<text class="dt" x="${f(ox - 2)}" y="${f(oy + L + EMB + 6)}" style="text-anchor:start">${esc(t('rod'))}: ${esc(t('rodNote'))}</text>`;
    inner += g;
    x += 120;
    H = Math.max(H, oy + L + EMB + 14);
  }
  const W = Math.max(x + M, 180);
  H += 30;
  inner += textLines(M, H - 18, summaryLines(dial, ctx).slice(0, 3), 3.2);
  return { W, H, inner, css: '', name: 'gnomon' };
}

const fmtMin = (m) => {
  const sgn = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  const mi = Math.floor(a), se = Math.round((a - mi) * 60);
  return `${sgn}${se === 60 ? mi + 1 : mi} m ${String(se === 60 ? 0 : se).padStart(2, '0')} s`;
};

export function infoSheet(dial, ctx) {
  const { s, t } = ctx;
  const W = 210, H = 297, x = 15;
  let y = 18;
  let inner = textLines(x, y, [{ t: `${t('title')} — ${t('sheetInfo')}`, b: true }], 5.5);
  y += 10;
  inner += textLines(x, y, [{ t: t('params'), b: true }, ...summaryLines(dial, ctx)], 3.4);
  y += 6 * 3.4 * 1.45;
  const a = dial.angles;
  inner += textLines(x, y, [{ t: t('angles'), b: true },
    `${t('SH')}: ${a.SH.toFixed(2)}°   ${t('SD')}: ${a.SD.toFixed(2)}°   ${t('DL')}: ${a.DL.toFixed(2)}°   ${t('substyleHour')}: ${fmtHM((12 + a.DL / 15) * 60)}`,
    dial.root ? `R = (${dial.root[0].toFixed(1)}, ${dial.root[1].toFixed(1)}) mm from F (x right, y up); |RF| = ${Math.hypot(...dial.root).toFixed(1)} mm` : t('noPolar'),
  ], 3.4);
  y += 4 * 3.4 * 1.45 + 2;
  inner += textLines(x, y, [{ t: t('stepsTitle'), b: true }, ...t('steps').map((st, i) => `${i + 1}. ${st}`)], 3.4);
  y += (t('steps').length + 1) * 3.4 * 1.45 + 4;
  // corrections table
  inner += textLines(x, y, [{ t: t('tableTitle'), b: true }], 3.6);
  y += 7;
  const cols = [x, x + 30, x + 58, x + 98, x + 138];
  const head = [t('colDate'), t('colEot'), t('colSolar'), t('colZone'), t('colDst')];
  inner += head.map((h, i) => `<text class="st sb" x="${cols[i]}" y="${f(y)}" font-size="3.2">${esc(h)}</text>`).join('');
  y += 2;
  inner += `<path class="dim" d="M${x} ${f(y)}H${W - x}"/>`;
  y += 4.6;
  const months = t('monthsShort');
  const lonCorr = lonCorrection(s.lon, s.tz);
  for (let mo = 0; mo < 12; mo++) {
    for (const day of [1, 15]) {
      const i = Math.round((Date.UTC(REF_YEAR, mo, day) - Date.UTC(REF_YEAR, 0, 1)) / 86400000);
      const ms = dayMs(i);
      const { eot } = solarParams(ms);
      const dst = s.dst !== 'none' && isDst(ms, s.tz, s.dst);
      const row = [`${day} ${months[mo]}`, fmtMin(eot), fmtMin(lonCorr - eot), fmtMin(-eot), dst ? '+60 m' : ''];
      inner += row.map((v, k) => `<text class="st" x="${cols[k]}" y="${f(y)}" font-size="3.2">${esc(v)}</text>`).join('');
      y += 4.6;
    }
  }
  return { W, H, inner, css: '', name: 'info' };
}

// ---------------- Tiling ----------------

export const PAPERS = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };

/** Split a sheet into printable pages with overlap and shared registration marks. */
const PRINT_MARGIN = 8; // unprintable margin, mm

/** Page grid for a W×H sheet: orientation with the fewest pages. null if no paper. */
export function tileLayout(W, H, paper, overlap) {
  if (!PAPERS[paper]) return null;
  const pm = PRINT_MARGIN;
  let best = null;
  for (const [pw, ph] of [PAPERS[paper], [PAPERS[paper][1], PAPERS[paper][0]]]) {
    const aw = pw - 2 * pm, ah = ph - 2 * pm, sx = aw - overlap, sy = ah - overlap;
    const nx = Math.max(1, Math.ceil((W - overlap) / sx)), ny = Math.max(1, Math.ceil((H - overlap) / sy));
    if (!best || nx * ny < best.nx * best.ny) best = { pw, ph, aw, ah, sx, sy, nx, ny };
  }
  return best;
}
export const tileName = (base, i, j) => `${base}-r${j + 1}c${i + 1}`;

export function tileSheets(sheet, paper, overlap, label) {
  const lay = tileLayout(sheet.W, sheet.H, paper, overlap);
  if (!lay) return [];
  const pm = PRINT_MARGIN;
  const { pw, ph, aw, ah, sx, sy, nx, ny } = lay;
  let regs = '';
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    const cx = i * sx + overlap / 2, cy = j * sy + overlap / 2;
    regs += `<circle class="reg" cx="${f(cx)}" cy="${f(cy)}" r="3"/><path class="reg" d="M${f(cx - 5)} ${f(cy)}H${f(cx + 5)}M${f(cx)} ${f(cy - 5)}V${f(cy + 5)}"/>`;
  }
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x0 = i * sx, y0 = j * sy;
    const id = `c${i}_${j}`;
    const inner = `<clipPath id="${id}"><rect x="${f(x0)}" y="${f(y0)}" width="${f(aw)}" height="${f(ah)}"/></clipPath>
<g clip-path="url(#${id})">${sheet.inner}${regs}</g>
<rect class="tileb" x="${f(x0)}" y="${f(y0)}" width="${f(aw)}" height="${f(ah)}"/>
<text class="dt" x="${f(x0)}" y="${f(y0 - 3)}" style="text-anchor:start">${esc(label)} — ${j + 1}/${ny} · ${i + 1}/${nx} (row · column), overlap ${overlap} mm</text>`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pw}mm" height="${ph}mm" viewBox="${f(x0 - pm)} ${f(y0 - pm)} ${pw} ${ph}">
${DEFS}<style>${sheet.css}${SHEET_CSS}</style>${inner}</svg>`;
    out.push({ name: tileName(sheet.name, i, j), svg, pw, ph });
  }
  return out;
}

