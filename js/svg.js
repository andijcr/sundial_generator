// SVG builders: interactive front view, printable sheets (face, gnomon, info)
// and page tiling. Pure string generation, no DOM, so Node can run it too.
//
// Sheet units: 1 user unit = 1 mm (width/height are given in "mm").

import { dayMs, REF_YEAR, fmtHM, lonCorrection, yearCorrections } from './astro.js';
import { bladeHeight, absoluteDeclination } from './dial.js';

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

// Black-and-white print: no colours, so the line families are told apart by weight and dash pattern
// (the pattern is in multiples of 4·sw). [weight multiplier, dash]
const BW_STYLE = {
  hour: [1.6], hourMinor: [0.7], hourExt: [0.5, '2 1.5'],
  zone: [1.3, '7 2.5'], zoneMinor: [0.6, '7 2.5'], zoneExt: [0.5, '1 2'],
  anaR: [1], anaF: [1, '3 1.5'], tick: [1],
  date: [1.1], dateMinor: [0.6, '4 1.5'],
  ital: [0.8, '9 2 1.5 2'], bab: [0.8, '3 3'],
  az: [0.5, '1 1.5'], alt: [0.5, '0.6 2.4'],
  construct: [0.6, '12 3'],
};

/** CSS for the dial. bw: black-and-white print (no plate fill, black only, families told apart by dashes). */
export function dialCss(material, sw, bw = false) {
  const laser = material === 'laser';
  const black = laser || bw;
  let css = laser
    ? `.plate{fill:none;stroke:#f00;stroke-width:0.1}`
    : bw ? `.plate{fill:none;stroke:#000;stroke-width:${f(sw * 2)}}`
      : `.plate{fill:#fbf6ea;stroke:#3b3b3b;stroke-width:${f(sw * 2)}}`;
  for (const [k, [c, w, d]] of Object.entries(LSTYLE)) {
    const [wm, dash] = bw && !laser ? BW_STYLE[k] : [w, d];
    css += `.l-${k}{fill:none;stroke:${black ? '#000' : c};stroke-width:${f(laser ? 0.1 : sw * wm)};stroke-linecap:round;stroke-linejoin:round${dash && !laser ? `;stroke-dasharray:${dash.split(' ').map((x) => f(x * sw * 4)).join(' ')}` : ''}}`;
  }
  css += `.t{font-family:${material === 'tile' ? 'Georgia,serif' : 'Helvetica,Arial,sans-serif'};text-anchor:middle;dominant-baseline:central}`;
  for (const [k, c] of Object.entries(TCOLOR)) css += `.t-${k}{fill:${black ? '#000' : c}}`;
  if (bw && !laser) css += '.t-dst{font-style:italic}'; // summer-time numbers lose their amber: set them in italics
  css += `.mark{fill:none;stroke:${black ? '#000' : '#333'};stroke-width:${f(laser ? 0.1 : sw * 1.2)}}`;
  css += `.info{fill:${black ? '#000' : '#555'};font-family:Helvetica,Arial,sans-serif}.motto{fill:${black ? '#000' : '#333'};font-family:Georgia,serif;font-style:italic;text-anchor:middle}`;
  return css;
}

/** CSS shared by the print sheets (dimensions, text, cut-outs, page frames). */
function sheetCss(bw) {
  const ink = bw ? '#000' : '#444', text = bw ? '#000' : '#222';
  return `.dim{stroke:${ink};stroke-width:0.25;fill:none}.dimx{stroke:${ink};stroke-width:0.18;fill:none}
.dt{font-family:Helvetica,Arial,sans-serif;font-size:3.5px;fill:${text};text-anchor:middle}
.st{font-family:Helvetica,Arial,sans-serif;fill:${text}}.sb{font-weight:bold}
.cut{fill:${bw ? 'none' : '#f3efe4'};stroke:#000;stroke-width:0.35}.fold{stroke:#000;stroke-width:0.3;stroke-dasharray:3 2;fill:none}
.reg{stroke:#000;stroke-width:0.2;fill:none}.tileb{stroke:${bw ? '#000' : '#999'};stroke-width:0.2;stroke-dasharray:2 2;fill:none}.nodus{fill:${bw ? '#000' : '#c0392b'}}` + graphCss(bw);
}

const defs = (bw) => `<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${bw ? '#000' : '#444'}"/></marker></defs>`;

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
  if (ctx.s.gBlade) {
    // seen from the front the blade is edge-on: a vertical bar from F up to height h
    g += `<line x1="${f(P.fx)}" y1="${f(P.fy)}" x2="${f(P.fx)}" y2="${f(P.fy - bladeHeight(dial.L))}" stroke="#2b2b2b" stroke-width="${f(Math.max(sw * 5, 2))}" stroke-linecap="round"/>`;
  }
  // rod and blade both point at the viewer from F: one dot
  if (ctx.s.gRod || ctx.s.gBlade) g += `<circle cx="${f(P.fx)}" cy="${f(P.fy)}" r="${f(dial.fontSize * 0.35)}" fill="#2b2b2b"/>`;
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
    if (ctx.s.gBlade) {
      const A = [0, bladeHeight(dial.L)];
      out += `<polygon points="${X(A)},${Y(A)} ${X([0, 0])},${Y([0, 0])} ${X(Sc)},${Y(Sc)}" fill="rgba(20,20,30,0.38)"/>`;
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
${defs(sheet.bw)}<style>${sheet.css}${sheetCss(sheet.bw)}</style>
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
      : `<text class="dt" x="${f(x < xRef ? cx - 1.5 : cx + 1.5)}" y="${f(Math.max(y1, y2) + 4.5)}" style="text-anchor:${x < xRef ? 'end' : 'start'}">${esc(text)}</text>`);
}
const mm = (x) => `${x.toFixed(1)} mm`;

/** Greedy word wrap to lines of at most n characters. */
function wrapText(str, n) {
  const out = [];
  let cur = '';
  for (const w of String(str).split(' ')) {
    if (cur && (cur + ' ' + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return out;
}

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
    `D = ${s.D.toFixed(1)}° ${t('dRef')} (${t('faces')} ${((180 + absoluteDeclination(s.lat, s.D) + 360) % 360).toFixed(1)}° N→E) · L = ${mm(dial.L)} · ${dial.plate.w.toFixed(0)} × ${dial.plate.h.toFixed(0)} mm`,
    `${t('SH')} ${a.SH.toFixed(2)}° · ${t('SD')} ${a.SD.toFixed(2)}° · ${t('DL')} ${a.DL.toFixed(2)}°`,
    systems,
  ];
}

const CHAR_W = 2.0; // estimated width of one character of a 3.5 px dimension label, mm

/**
 * Margins of the face sheet around the plate, sized to what is drawn there (dimension lines, their labels,
 * the title block) so the sheet is no bigger than it needs to be: every millimetre saved can save a
 * printed page. Label widths are estimated. A short vertical dimension puts its label to the right of its line.
 */
function faceMargins(dial, s) {
  const P = dial.plate;
  const R = dial.root && s.gPolar ? [P.fx + dial.root[0], P.fy - dial.root[1]] : null; // style root in plate coords, y down
  const rightOf = (x, len, text) => x + (Math.abs(len) > 28 ? 2 : 1.5 + text.length * CHAR_W);
  let right = rightOf(12, P.fy, `F ${mm(P.fy)}`);
  let left = 17.5, top = 17.8;
  if (R) {
    right = Math.max(right, rightOf(24, R[1], `R ${mm(R[1])}`), R[0] - P.w + 8);
    left = Math.max(left, 8 - R[0]);
    top = Math.max(top, 6 - R[1]);
  }
  const m = { L: Math.ceil(left + 4), T: Math.ceil(top + 4), R: Math.ceil(right + 4), B: 74 };
  m.R = Math.max(m.R, 200 - P.w - m.L); // the title block is about 170 mm wide
  return m;
}

/** Size of the face sheet in mm, without rendering it. s: the settings (is the triangular style drawn?). */
export function faceSheetSize(dial, s = { gPolar: true }) {
  const m = faceMargins(dial, s);
  return { W: dial.plate.w + m.L + m.R, H: dial.plate.h + m.T + m.B };
}

export function faceSheet(dial, ctx) {
  const { s, t } = ctx;
  const P = dial.plate;
  const { sw } = sizesFor(s.material, P);
  const { L: ML, T: MT, R: MR } = faceMargins(dial, s);
  const { W, H } = faceSheetSize(dial, s);
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
  return { W, H, inner, css: dialCss(s.material, sw, s.ink === 'bw'), name: 'face', bw: s.ink === 'bw' };
}

export function gnomonSheet(dial, ctx) {
  const { s, t } = ctx;
  const L = dial.L, M = 14, TAB = 15;
  let inner = '', x = M, H = 0;
  let right = M + 150; // right edge of the drawing (estimated), so the sheet is no wider than needed; 150 mm for the summary lines
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
    const edgeLabel = `${t('styleEdge')} — ${mm(hyp)}`;
    if (hyp > edgeLabel.length * 1.8 + 10) { // along the edge when it is long enough, else in the caption below
      g += `<text class="dt" x="${f(mx - 3)}" y="${f(my - 3)}" transform="rotate(${f(ang)} ${f(mx - 3)} ${f(my - 3)})">${esc(edgeLabel)}</text>`;
    } else {
      g += `<text class="dt" x="${f(ox)}" y="${f(oy + tb + 25)}" style="text-anchor:start">${esc(edgeLabel)}</text>`;
    }
    g += `<text class="dt" x="${f(ox - 3)}" y="${f(oy + 1)}" style="text-anchor:end">R</text>`;
    g += `<text class="dt" x="${f(ox + a + 3)}" y="${f(oy + 4)}" style="text-anchor:start">F</text>`;
    g += `<text class="dt" x="${f(ox + a + 3)}" y="${f(oy - L - 2)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    g += `<circle cx="${f(ox + a)}" cy="${f(oy - L)}" r="1" class="nodus"/>`;
    g += `<text class="dt" x="${f(ox + a / 2)}" y="${f(oy + tb / 2 + 1)}">${esc(t('tab'))}</text>`;
    g += `<text class="dt" x="${f(ox)}" y="${f(oy + tb + 20)}" style="text-anchor:start">${esc(t('wallEdge'))}</text>`;
    inner += g;
    x += a + 36;
    right = Math.max(right, ox + a + 24);
    H = Math.max(H, oy + tb + 30);
  } else if (s.gPolar) {
    const lines = wrapText(t('noPolar'), 40);
    inner += textLines(M, top + 8, lines, 4);
    x += 100; // keep the blade / rod clear of the text
    right = Math.max(right, M + 90);
    H = Math.max(H, top + 8 + lines.length * 4 * 1.45 + 12);
  }
  if (s.gBlade) {
    // flat fin in the vertical plane: wall edge on the left (F at its foot), bottom edge out to the nodus N,
    // sloping edge back up to the wall at height h. A fold tab runs along the wall edge.
    const h = bladeHeight(L), tb = Math.min(TAB, L / 4);
    const bx = x + TAB + 10, ay = top + 10, fy = ay + h;
    const tip = Math.atan2(h, L) * 180 / Math.PI, th = tip * Math.PI / 180;
    let g = `<polygon class="cut" points="${f(bx)},${f(ay)} ${f(bx)},${f(fy)} ${f(bx + L)},${f(fy)}"/>`;
    g += `<polygon class="cut" points="${f(bx)},${f(ay)} ${f(bx)},${f(fy)} ${f(bx - tb)},${f(fy - tb)} ${f(bx - tb)},${f(ay + tb)}"/>`;
    g += `<path class="fold" d="M${f(bx)} ${f(ay)}V${f(fy)}"/>`;
    // What fits on the drawing stays on it; the rest goes to the caption (decided once, here).
    const roomy = L >= 45;
    const tabFits = roomy && h - 2 * tb >= t('tab').length * 1.9 + 6; // the rotated label must fit between the tab's slanted corners
    const r = Math.min(L, h, 60) * 0.3;
    if (roomy) {
      g += `<path class="dim" d="M${f(bx + L - r)} ${f(fy)}A${f(r)} ${f(r)} 0 0 1 ${f(bx + L - r * Math.cos(th))} ${f(fy - r * Math.sin(th))}"/>`;
      g += `<text class="dt" x="${f(bx + L - r - 3)}" y="${f(fy - 2)}" style="text-anchor:end">${tip.toFixed(1)}°</text>`;
    }
    g += dimH(bx, bx + L, fy + 9, fy, `L = ${mm(L)}`);
    g += dimV(ay, fy, bx - tb - 10, bx - tb - 1, `h = ${mm(h)}`);
    g += `<circle cx="${f(bx + L)}" cy="${f(fy)}" r="1" class="nodus"/>`;
    g += `<text class="dt" x="${f(bx + L + 3)}" y="${f(fy + 1)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    if (roomy) {
      g += `<text class="dt" x="${f(bx + 3)}" y="${f(fy - 3)}" style="text-anchor:start">F</text>`;
      g += `<text class="dt" x="${f(bx + 3)}" y="${f(ay + 4)}" style="text-anchor:start">${esc(t('bladeTop'))}</text>`;
    }
    // label beside the sloping edge (it descends to the right on the sheet), offset to its upper side
    const lx = bx + L / 2 + 3 * Math.sin(th), ly = fy - h / 2 - 3 * Math.cos(th);
    if (roomy) g += `<text class="dt" x="${f(lx)}" y="${f(ly)}" transform="rotate(${f(tip)} ${f(lx)} ${f(ly)})">${esc(t('bladeBrace'))} — ${mm(Math.hypot(L, h))}</text>`;
    if (tabFits) g += `<text class="dt" x="${f(bx - tb / 2)}" y="${f((ay + fy) / 2)}" transform="rotate(-90 ${f(bx - tb / 2)} ${f((ay + fy) / 2)})">${esc(t('tab'))}</text>`;
    inner += g;
    const caption = [t('bladeWallEdge')];
    if (!roomy) caption.push(`${t('bladeTop')}: ↑ · ${tip.toFixed(1)}° · ${t('bladeBrace')} ${mm(Math.hypot(L, h))}`);
    if (!tabFits) caption.push(t('bladeTabAt'));
    inner += textLines(bx - tb, fy + 22, [...caption, ...wrapText(`${t('blade')}: ${t('bladeNote')}`, 52)], 3.2);
    x += Math.max(TAB + L + 70, 115);
    right = Math.max(right, bx + L + 24, bx - tb + 90);
    H = Math.max(H, fy + 40);
  }
  if (s.gRod || (s.gPolar && !dial.root)) {
    const EMB = 30, ox = x + 10, oy = top + 10;
    let g = `<rect class="cut" x="${f(ox - 2)}" y="${f(oy)}" width="4" height="${f(L + EMB)}"/>`;
    g += `<path class="fold" d="M${f(ox - 10)} ${f(oy + L)}H${f(ox + 10)}"/>`;
    g += `<circle cx="${f(ox)}" cy="${f(oy)}" r="1.2" class="nodus"/>`;
    g += dimV(oy, oy + L, ox + 14, ox + 2, `L = ${mm(L)}`);
    g += `<text class="dt" x="${f(ox + 6)}" y="${f(oy + L + EMB / 2)}" style="text-anchor:start">${EMB} mm ${esc(t('rodEmbed'))}</text>`;
    g += `<text class="dt" x="${f(ox + 6)}" y="${f(oy - 3)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    g += textLines(ox - 2, oy + L + EMB + 6, wrapText(`${t('rod')}: ${t('rodNote')}`, 38), 3.5);
    inner += g;
    right = Math.max(right, ox + 30, ox - 2 + 38 * 1.9);
    H = Math.max(H, oy + L + EMB + 14);
  }
  const W = Math.max(Math.ceil(right + 12), 180);
  H += 30;
  inner += textLines(M, H - 18, summaryLines(dial, ctx).slice(0, 3), 3.2);
  return { W, H, inner, css: '', name: 'gnomon', bw: s.ink === 'bw' };
}

export const fmtMin = (m) => {
  const sgn = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  const mi = Math.floor(a), se = Math.round((a - mi) * 60);
  return `${sgn}${se === 60 ? mi + 1 : mi} m ${String(se === 60 ? 0 : se).padStart(2, '0')} s`;
};

export function infoSheet(dial, ctx) {
  const { s, t } = ctx;
  const W = 190, x = 10; // fits an A4 page inside a typical printer margin; the height follows the content
  let y = 14;
  let inner = textLines(x, y, [{ t: `${t('title')} — ${t('sheetInfo')}`, b: true }], 4.8);
  y += 10;
  // a block of text, wrapped to the sheet's width (about 170 mm of 3.4 px text); the next block starts below it
  const block = (lines, gap) => {
    const wrapped = lines.flatMap((l) => (typeof l === 'string' ? wrapText(l, 88) : [l]));
    inner += textLines(x, y, wrapped, 3.4);
    y += wrapped.length * 3.4 * 1.45 + gap;
  };
  block([{ t: t('params'), b: true }, ...summaryLines(dial, ctx)], 3.4 * 1.45);
  const a = dial.angles;
  block([{ t: t('angles'), b: true },
    `${t('SH')}: ${a.SH.toFixed(2)}°   ${t('SD')}: ${a.SD.toFixed(2)}°   ${t('DL')}: ${a.DL.toFixed(2)}°   ${t('substyleHour')}: ${fmtHM((12 + a.DL / 15) * 60)}`,
    dial.root ? `R = (${dial.root[0].toFixed(1)}, ${dial.root[1].toFixed(1)}) mm from F (x right, y up); |RF| = ${Math.hypot(...dial.root).toFixed(1)} mm` : t('noPolar'),
  ], 5);
  block([{ t: t('stepsTitle'), b: true }, ...t('steps').map((st, i) => `${i + 1}. ${st}`)], 4);
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
  const corr = yearCorrections(s.lon, s.tz, s.dst); // the same data as the correction chart
  for (let mo = 0; mo < 12; mo++) {
    for (const day of [1, 15]) {
      const i = Math.round((Date.UTC(REF_YEAR, mo, day) - Date.UTC(REF_YEAR, 0, 1)) / 86400000);
      const d = corr[i];
      const row = [`${day} ${months[mo]}`, fmtMin(d.eot), fmtMin(d.solar), fmtMin(d.zone), d.dst ? '+60 m' : ''];
      inner += row.map((v, k) => `<text class="st" x="${cols[k]}" y="${f(y)}" font-size="3.2">${esc(v)}</text>`).join('');
      y += 4.6;
    }
  }
  const H = Math.ceil(y + 2);
  return { W, H, inner, css: '', name: 'info', bw: s.ink === 'bw' };
}

// ---------------- Correction chart ----------------

const signed1 = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`; // one decimal, with a proper minus sign

/**
 * CSS of the correction chart. page: the chart sits on the web page, so take text and grid colours from
 * the page's theme (light or dark). bw: black and white print (families told apart by dashes).
 */
export function graphCss(bw, page = false) {
  const text = page ? 'var(--ink)' : bw ? '#000' : '#222';
  const axis = page ? 'var(--muted)' : bw ? '#000' : '#444';
  const grid = page ? 'var(--line)' : bw ? '#000' : '#c8c8c8';
  const solar = page ? 'var(--ink)' : bw ? '#000' : '#1b1b1b';
  const zone = bw ? '#000' : '#1f5fa8';
  const today = bw ? '#000' : '#e4572e';
  const band = page ? 'rgba(240,160,32,0.22)' : '#f6e7bf';
  return `.cg-t{font-family:Helvetica,Arial,sans-serif;font-size:3.2px;fill:${text}}.cg-s{font-size:2.8px}.cg-b{font-weight:bold}` +
    `.cg-axis{stroke:${axis};stroke-width:0.3;fill:none}.cg-grid{stroke:${grid};stroke-width:0.12;fill:none${bw ? ';stroke-dasharray:0.4 1.6' : ''}}` +
    `.cg-solar{fill:none;stroke:${solar};stroke-width:0.7;stroke-linejoin:round}.cg-zone{fill:none;stroke:${zone};stroke-width:0.7;stroke-linejoin:round${bw ? ';stroke-dasharray:3 1.4' : ''}}` +
    `.cg-solar-dot{fill:${solar}}.cg-zone-dot{fill:${zone}}` +
    `.cg-dst{fill:${bw ? 'none' : band};stroke:${bw ? '#000' : 'none'};stroke-width:0.2;stroke-dasharray:1 1}` +
    `.cg-today{stroke:${today};stroke-width:0.4;fill:none}`;
}

/**
 * The correction to apply, through the year, as a chart: minutes to add to the dial reading to get
 * the standard clock time (y) against the date (x), one curve for the solar-time lines and one for the
 * zone-time lines. Summer time is not folded into the curves (that would drown the wiggle in a 60 min
 * step): the months it is in force are marked (shaded; outlined in black and white), with "add 60 more minutes". The extremes are labelled.
 * data: yearCorrections(). Drawn into the box (x, y, w, h), mm. Returns { markup, X, Y, lo, hi, box }, where
 * X(dayOfYear) and Y(minutes) are the plot's coordinates (used to place a "today" marker).
 */
export function correctionGraph(data, { x = 0, y = 0, w = 250, h = 100, t }) {
  const px = x + 13, py = y + 9, pw = w - 13 - 3, ph = h - 9 - 9; // room for the axis labels, the legend row and the month names
  const n = data.length, months = t('monthsShort');
  const all = data.flatMap((d) => [d.solar, d.zone]);
  const step = Math.max(...all, 0) - Math.min(...all, 0) > 40 ? 10 : 5;
  const lo = Math.floor((Math.min(...all, 0) - 2) / step) * step, hi = Math.ceil((Math.max(...all, 0) + 2) / step) * step;
  const X = (day) => px + ((day + 0.5) / n) * pw;
  const Y = (v) => py + ph - ((v - lo) / (hi - lo)) * ph;
  let g = '';
  // the months summer time is in force
  const runs = [];
  data.forEach((d, i) => { if (d.dst) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); } });
  for (const [a, b] of runs) g += `<rect class="cg-dst" x="${f(px + (a / n) * pw)}" y="${f(py)}" width="${f(((b - a + 1) / n) * pw)}" height="${f(ph)}"/>`;
  // grid, with the minutes on the left (zero drawn as an axis)
  for (let v = lo; v <= hi + 1e-9; v += step) {
    g += `<path class="${v === 0 ? 'cg-axis' : 'cg-grid'}" d="M${f(px)} ${f(Y(v))}H${f(px + pw)}"/>`;
    g += `<text class="cg-t" x="${f(px - 1.5)}" y="${f(Y(v) + 1.1)}" style="text-anchor:end">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</text>`;
  }
  const first = (m) => Math.round((Date.UTC(REF_YEAR, m, 1) - Date.UTC(REF_YEAR, 0, 1)) / 86400000);
  for (let m = 0; m < 12; m++) {
    const a = first(m), b = m < 11 ? first(m + 1) : n;
    if (m > 0) g += `<path class="cg-grid" d="M${f(px + (a / n) * pw)} ${f(py)}V${f(py + ph)}"/>`;
    g += `<text class="cg-t" x="${f(px + ((a + b) / 2 / n) * pw)}" y="${f(py + ph + 4.5)}" style="text-anchor:middle">${esc(months[m])}</text>`;
  }
  g += `<path class="cg-axis" d="M${f(px)} ${f(py)}V${f(py + ph)}H${f(px + pw)}"/>`;
  g += `<text class="cg-t" x="${f(x + 2.5)}" y="${f(py + ph / 2)}" transform="rotate(-90 ${f(x + 2.5)} ${f(py + ph / 2)})" style="text-anchor:middle">${esc(t('cgY'))}</text>`;
  // the curves
  const path = (key) => 'M' + data.map((d, i) => `${f(X(i))} ${f(Y(d[key]))}`).join('L');
  g += `<path class="cg-zone" d="${path('zone')}"/><path class="cg-solar" d="${path('solar')}"/>`;
  // the extremes: value and date, above a maximum and below a minimum
  const dateOf = (i) => { const d = new Date(dayMs(i)); return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`; };
  const sep = Math.max(...data.map((d) => Math.abs(d.solar - d.zone)));
  for (const [key, cls] of [['solar', 'cg-solar-dot'], ['zone', 'cg-zone-dot']]) {
    if (key === 'zone' && sep < 2) continue; // the two curves almost coincide: one set of labels is enough
    let imax = 0, imin = 0;
    data.forEach((d, i) => { if (d[key] > data[imax][key]) imax = i; if (d[key] < data[imin][key]) imin = i; });
    for (const [i, up] of [[imax, true], [imin, false]]) {
      const v = data[i][key], cx = X(i), cy = Y(v), lx = Math.min(px + pw - 14, Math.max(px + 14, cx));
      g += `<circle class="${cls}" cx="${f(cx)}" cy="${f(cy)}" r="0.9"/>`;
      g += `<text class="cg-t cg-s" x="${f(lx)}" y="${f(up ? cy - 2 : cy + 4.5)}" style="text-anchor:middle">${signed1(v)} · ${esc(dateOf(i))}</text>`;
    }
  }
  // legend row
  const ly = y + 3.5;
  g += `<path class="cg-solar" d="M${f(px)} ${f(ly - 1.1)}h8"/><text class="cg-t" x="${f(px + 10)}" y="${f(ly)}">${esc(t('colSolar'))}</text>`;
  g += `<path class="cg-zone" d="M${f(px + 46)} ${f(ly - 1.1)}h8"/><text class="cg-t" x="${f(px + 56)}" y="${f(ly)}">${esc(t('colZone'))}</text>`;
  if (runs.length) g += `<rect class="cg-dst" x="${f(px + 92)}" y="${f(ly - 2.8)}" width="8" height="3.6"/><text class="cg-t" x="${f(px + 102)}" y="${f(ly)}">${esc(t('cgDst'))}</text>`;
  return { markup: `<g>${g}</g>`, X, Y, lo, hi, box: { px, py, pw, ph } };
}

/** "Today" on the chart: a vertical line and a dot on each curve. day: day of the year (fractions allowed). */
export function correctionMarker(graph, day, solar, zone) {
  const cx = graph.X(day), cl = (v) => Math.min(graph.hi, Math.max(graph.lo, v));
  return `<path class="cg-today" d="M${f(cx)} ${f(graph.box.py)}V${f(graph.box.py + graph.box.ph)}"/>` +
    `<circle class="cg-zone-dot" cx="${f(cx)}" cy="${f(graph.Y(cl(zone)))}" r="1.4"/><circle class="cg-solar-dot" cx="${f(cx)}" cy="${f(graph.Y(cl(solar)))}" r="1.4"/>`;
}

/** A print sheet with the correction chart and how to use it (sits on one A4 landscape page). */
export function correctionSheet(dial, ctx) {
  const { s, t } = ctx;
  const W = 270, x = 10, gy = 28, gh = 108;
  const data = yearCorrections(s.lon, s.tz, s.dst);
  const g = correctionGraph(data, { x, y: gy, w: W - 2 * x, h: gh, t });
  let inner = textLines(x, 14, [{ t: `${t('title')} — ${t('sheetCorr')}`, b: true }], 4.8);
  inner += textLines(x, 21, [summaryLines(dial, ctx)[0]], 3.4);
  inner += g.markup;
  const notes = [t('cgHow'), t('cgLon', signed1(lonCorrection(s.lon, s.tz)))].flatMap((n) => wrapText(n, 130));
  inner += textLines(x, gy + gh + 8, notes, 3.4);
  const H = Math.ceil(gy + gh + 8 + notes.length * 3.4 * 1.45 + 4);
  return { W, H, inner, css: '', name: 'correction', bw: s.ink === 'bw' };
}

// ---------------- Tiling ----------------

export const PAPERS = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };

export const PRINT_MARGIN = 8; // default unprintable margin of a printer, mm
const PAGE_HEADER = 7; // strip at the top of every page, inside the printable area, for the page label

/** Number of pages needed to cover len mm when a page offers `avail` mm and neighbours overlap by `overlap`. */
const pagesFor = (len, avail, overlap) => (len <= avail ? 1 : Math.ceil((len - overlap) / (avail - overlap)));

/**
 * Plan how a W×H mm sheet is cut into pages of a paper size (always 1:1, never scaled).
 * opts.orient: 'auto' (default: the orientation needing the fewest pages, then wasting the least paper,
 * then matching the sheet's shape), 'portrait' or 'landscape'. opts.margin: the printer's unprintable margin, mm.
 * The slack is shared out evenly, so no page is left with a sliver, and each tile is centred in the printable
 * area below a header strip that carries the page label. A sheet that fits is a single page with no overlap.
 * Returns null when there is no such paper size or the margins leave no room.
 */
export function tileLayout(W, H, paper, overlap, opts = {}) {
  if (!PAPERS[paper]) return null;
  const pm = clamp(Number.isFinite(opts.margin) ? opts.margin : PRINT_MARGIN, 0, 30);
  const [a, b] = PAPERS[paper]; // short and long side
  const orients = opts.orient === 'portrait' || opts.orient === 'landscape' ? [opts.orient] : ['portrait', 'landscape'];
  let best = null;
  for (const orient of orients) {
    const [pw, ph] = orient === 'portrait' ? [a, b] : [b, a];
    const aw = pw - 2 * pm, ah = ph - 2 * pm - PAGE_HEADER; // room for the drawing on one page
    if (aw <= overlap + 20 || ah <= overlap + 20) continue;
    const nx = pagesFor(W, aw, overlap), ny = pagesFor(H, ah, overlap);
    const c = { orient, pw, ph, aw, ah, nx, ny, pages: nx * ny, waste: nx * ny * aw * ah - W * H, matches: (orient === 'landscape') === (W >= H) };
    // equal page counts: on one page prefer the orientation that matches the sheet's shape; on several, the one wasting less paper
    const tieBetter = c.pages === 1 ? c.matches && !best?.matches
      : c.waste < best?.waste - 1e-6 || (Math.abs(c.waste - best?.waste) <= 1e-6 && c.matches && !best?.matches);
    const better = !best || c.pages < best.pages || (c.pages === best.pages && tieBetter);
    if (better) best = c;
  }
  if (!best) return null;
  const { nx, ny } = best, ov = best.pages === 1 ? 0 : overlap;
  const sx = nx === 1 ? W : (W - ov) / nx, sy = ny === 1 ? H : (H - ov) / ny; // step between neighbouring tiles
  return { ...best, margin: pm, header: PAGE_HEADER, overlap: ov, sx, sy, tw: nx === 1 ? W : sx + ov, th: ny === 1 ? H : sy + ov };
}
/**
 * The cheapest way to save pages: trimming `mm` off the sheet's width ('W') or height ('H') removes a whole
 * column or row of pages. Only offered when the trim is small (at most 12 % of that side), as {axis, mm, pages}
 * with pages = how many pages it saves; null if there is nothing worthwhile. lay: a tileLayout result.
 */
export function tileSavings(W, H, lay) {
  if (!lay) return null;
  const cands = [];
  if (lay.nx > 1) cands.push({ axis: 'W', excess: W - ((lay.nx - 1) * (lay.aw - lay.overlap) + lay.overlap), len: W, pages: lay.ny });
  if (lay.ny > 1) cands.push({ axis: 'H', excess: H - ((lay.ny - 1) * (lay.ah - lay.overlap) + lay.overlap), len: H, pages: lay.nx });
  const ok = cands.filter((c) => c.excess > 0 && c.excess / c.len <= 0.12).sort((a, b) => b.pages / b.excess - a.pages / a.excess);
  return ok.length ? { axis: ok[0].axis, mm: Math.ceil(ok[0].excess * 10) / 10, pages: ok[0].pages } : null;
}

export const tileName = (base, i, j) => `${base}-r${j + 1}c${i + 1}`;

/**
 * Cut a sheet into printable pages (see tileLayout for opts). Neighbouring pages overlap, and the alignment
 * marks sit at the centres of the overlap zones so they coincide on two neighbouring pages.
 * Returns [{ name, svg, pw, ph, page, pages, orient }].
 */
export function tileSheets(sheet, paper, overlap, label, opts = {}) {
  const lay = tileLayout(sheet.W, sheet.H, paper, overlap, opts);
  if (!lay) return [];
  const { pw, ph, aw, ah, nx, ny, sx, sy, tw, th, margin: pm, header, orient, overlap: ov, pages } = lay;
  let regs = '';
  if (pages > 1) {
    const at = (n, step, len) => (n === 1 ? [ov / 2, len - ov / 2] : Array.from({ length: n + 1 }, (_, k) => k * step + ov / 2));
    for (const cx of at(nx, sx, sheet.W)) for (const cy of at(ny, sy, sheet.H)) {
      regs += `<circle class="reg" cx="${f(cx)}" cy="${f(cy)}" r="3"/><path class="reg" d="M${f(cx - 5)} ${f(cy)}H${f(cx + 5)}M${f(cx)} ${f(cy - 5)}V${f(cy + 5)}"/>`;
    }
  }
  const px = pm + (aw - tw) / 2, py = pm + header + (ah - th) / 2; // where a tile starts on the page
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x0 = nx === 1 ? 0 : i * sx, y0 = ny === 1 ? 0 : j * sy;
    const vx = x0 - px, vy = y0 - py; // sheet coordinates of the page's top-left corner
    const id = `clip-${sheet.name}-${i}-${j}`, page = j * nx + i + 1; // unique across sheets: several are printed in one document
    const note = `${label} — ${pages > 1 ? `${page}/${pages} (${j + 1}/${ny} · ${i + 1}/${nx}) · ` : ''}${paper} ${orient} · ${ov ? `overlap ${f(ov)} mm · ` : ''}margin ${f(pm)} mm`;
    const inner = `<clipPath id="${id}"><rect x="${f(x0)}" y="${f(y0)}" width="${f(tw)}" height="${f(th)}"/></clipPath>
<g clip-path="url(#${id})">${sheet.inner}${regs}</g>
<rect class="tileb" x="${f(x0)}" y="${f(y0)}" width="${f(tw)}" height="${f(th)}"/>
<text class="dt" x="${f(vx + pm)}" y="${f(vy + pm + 4.5)}" style="text-anchor:start">${esc(note)}</text>`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pw}mm" height="${ph}mm" viewBox="${f(vx)} ${f(vy)} ${pw} ${ph}">
${defs(sheet.bw)}<style>${sheet.css}${sheetCss(sheet.bw)}</style>${inner}</svg>`;
    out.push({ name: tileName(sheet.name, i, j), svg, pw, ph, page, pages, orient });
  }
  return out;
}

