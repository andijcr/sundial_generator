// SVG builders: interactive front view, printable sheets (face, gnomon, info)
// and page tiling. Pure string generation, no DOM, so Node can run it too.
//
// Sheet units: 1 user unit = 1 mm (width/height are given in "mm").

import { dayMs, dayOfYear, fmtHM, lonCorrection, yearCorrections } from './astro.js';
import { absoluteDeclination } from './dial.js';
import { makeT } from './i18n.js';

const f = (n) => String(Math.round(n * 100) / 100);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
  const line = laser ? LASER.score : '#000'; // laser: the dial's lines are scored (blue), its text engraved (black)
  let css = laser
    ? `.plate{fill:none;stroke:${LASER.cut};stroke-width:0.1}`
    : bw ? `.plate{fill:none;stroke:#000;stroke-width:${f(sw * 2)}}`
      : `.plate{fill:#fbf6ea;stroke:#3b3b3b;stroke-width:${f(sw * 2)}}`;
  for (const [k, [c, w, d]] of Object.entries(LSTYLE)) {
    const [wm, dash] = bw && !laser ? BW_STYLE[k] : [w, d];
    css += `.l-${k}{fill:none;stroke:${black ? line : c};stroke-width:${f(laser ? 0.1 : sw * wm)};stroke-linecap:round;stroke-linejoin:round${dash && !laser ? `;stroke-dasharray:${dash.split(' ').map((x) => f(x * sw * 4)).join(' ')}` : ''}}`;
  }
  css += `.t{font-family:${material === 'tile' ? 'Georgia,serif' : 'Helvetica,Arial,sans-serif'};text-anchor:middle;dominant-baseline:central}`;
  for (const [k, c] of Object.entries(TCOLOR)) css += `.t-${k}{fill:${black ? '#000' : c}}`;
  if (bw && !laser) css += '.t-dst{font-style:italic}'; // summer-time numbers lose their amber: set them in italics
  css += `.mark{fill:none;stroke:${black ? line : '#333'};stroke-width:${f(laser ? 0.1 : sw * 1.2)}}`;
  css += `.info{fill:${black ? '#000' : '#555'};font-family:Helvetica,Arial,sans-serif}.motto{fill:${black ? '#000' : '#333'};font-family:Georgia,serif;font-style:italic;text-anchor:middle}`;
  return css;
}

/** CSS shared by the print sheets (dimensions, text, cut-outs, page frames). laser: the colours are the laser layers. */
function sheetCss(bw, laser = false) {
  if (laser) {
    const n = LASER.notes;
    return `.dim{stroke:${n};stroke-width:0.25;fill:none}.dimx{stroke:${n};stroke-width:0.18;fill:none}
.dt{font-family:Helvetica,Arial,sans-serif;font-size:3.5px;fill:${n};text-anchor:middle}
.st{font-family:Helvetica,Arial,sans-serif;fill:${n}}.sb{font-weight:bold}
.cut{fill:none;stroke:${LASER.cut};stroke-width:0.1}.fold{stroke:${LASER.score};stroke-width:0.1;fill:none}
.reg{stroke:${n};stroke-width:0.2;fill:none}.tileb{stroke:${n};stroke-width:0.2;stroke-dasharray:2 2;fill:none}.nodus{fill:${n}}`;
  }
  const ink = bw ? '#000' : '#444', text = bw ? '#000' : '#222';
  return `.dim{stroke:${ink};stroke-width:0.25;fill:none}.dimx{stroke:${ink};stroke-width:0.18;fill:none}
.dt{font-family:Helvetica,Arial,sans-serif;font-size:3.5px;fill:${text};text-anchor:middle}
.st{font-family:Helvetica,Arial,sans-serif;fill:${text}}.sb{font-weight:bold}
.cut{fill:${bw ? 'none' : '#f3efe4'};stroke:#000;stroke-width:0.35}.fold{stroke:#000;stroke-width:0.3;stroke-dasharray:3 2;fill:none}
.reg{stroke:#000;stroke-width:0.2;fill:none}.tileb{stroke:${bw ? '#000' : '#999'};stroke-width:0.2;stroke-dasharray:2 2;fill:none}.nodus{fill:${bw ? '#000' : '#c0392b'}}`;
}

// The dimension arrowhead. A laser sheet has its own (#arrL, in the notes colour), so the sheets of one print job, which share
// one document, each keep their colour.
const arrow = (id, fill) => `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${fill}"/></marker>`;
const defs = (bw, laser = false) => `<defs>${laser ? arrow('arrL', LASER.notes) : arrow('arr', bw ? '#000' : '#444')}</defs>`;
const laserArrows = (markup) => markup.replaceAll('url(#arr)', 'url(#arrL)');

/** Scope a sheet's CSS (plain rules, no at-rules) to the given selectors: the sheets of a print job share one document. */
export function scopeCss(css, scopes) {
  return css.split('}').map((r) => r.trim()).filter(Boolean).map((r) => {
    const i = r.indexOf('{');
    const sel = r.slice(0, i).split(',').map((x) => x.trim()).filter(Boolean);
    return `${sel.flatMap((x) => scopes.map((sc) => `${sc} ${x}`)).join(',')}{${r.slice(i + 1)}}`;
  }).join('');
}

// ---------------- Laser layers ----------------

/** Laser colours, one per job: LightBurn and most laser software turn each colour into a layer. */
export const LASER = { cut: '#ff0000', score: '#0000ff', engrave: '#000000', notes: '#00a000' };
const LASER_LAYERS = [['cut', 'Cut'], ['score', 'Score (vector engrave)'], ['engrave', 'Engrave (text)'], ['notes', 'Notes (do not send to the laser)']];
const INKSCAPE_NS = 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

/** The elements of flat markup (self-closing tags and <text>…</text>), in order. */
export const markupTokens = (markup) => markup.match(/<text\b[\s\S]*?<\/text>|<[a-zA-Z]+\b[^>]*\/>/g) || [];

/** Laser layer of one element, from its class: outlines are cut, lines and folds scored, plate text engraved, the rest is notes. */
export function laserLayerOf(tag) {
  const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
  const has = (c) => cls.split(/\s+/).includes(c);
  if (has('plate') || has('cut')) return 'cut';
  if (/(^|\s)l-/.test(cls) || has('mark') || has('fold')) return 'score';
  if (has('t') || has('info') || has('motto')) return 'engrave';
  return 'notes';
}

/**
 * Sort sheet markup into Inkscape layers (one per laser job, in the job's colour). parts: [[markup, transform], ...], each
 * a flat run of elements in one coordinate system; a layer holds the matching elements of every part.
 */
export function laserLayers(parts) {
  const out = {};
  for (const [k] of LASER_LAYERS) out[k] = '';
  for (const [markup, tr] of parts) {
    const bucket = {};
    for (const tok of markupTokens(markup)) { const k = laserLayerOf(tok); bucket[k] = (bucket[k] || '') + tok; }
    for (const [k, v] of Object.entries(bucket)) out[k] += tr ? `<g transform="${tr}">${v}</g>` : v;
  }
  return LASER_LAYERS.filter(([k]) => out[k]).map(([k, label]) => `<g inkscape:groupmode="layer" inkscape:label="${label}">${out[k]}</g>`).join('\n');
}

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
    g += `<line x1="${f(P.fx)}" y1="${f(P.fy)}" x2="${f(P.fx)}" y2="${f(P.fy - dial.bladeH)}" stroke="#2b2b2b" stroke-width="${f(Math.max(sw * 5, 2))}" stroke-linecap="round"/>`;
  }
  // rod and blade both point at the viewer from F: one dot
  if (ctx.s.gRod || ctx.s.gBlade) g += `<circle cx="${f(P.fx)}" cy="${f(P.fy)}" r="${f(dial.fontSize * 0.35)}" fill="#2b2b2b"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-pad)} ${f(-pad)} ${f(P.w + 2 * pad)} ${f(P.h + 2 * pad)}" role="img" aria-label="${esc(ctx.t ? ctx.t('v2d') : 'Front view')}">
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
      // oversized triangle (rodX times bigger about the root R): its shadow is the same one scaled about R, the notch's shadow at Sc
      const k = ctx.s.rodX > 1 ? ctx.s.rodX : 1, Rt = dial.root, Fp = [Rt[0] * (1 - k), Rt[1] * (1 - k)], Ep = [Rt[0] + k * (Sc[0] - Rt[0]), Rt[1] + k * (Sc[1] - Rt[1])];
      out += `<polygon points="${X(Rt)},${Y(Rt)} ${X(Fp)},${Y(Fp)} ${X(Ep)},${Y(Ep)}" fill="rgba(20,20,30,0.38)"/>`;
    }
    if (ctx.s.gBlade) {
      const A = [0, dial.bladeH];
      out += `<polygon points="${X(A)},${Y(A)} ${X([0, 0])},${Y([0, 0])} ${X(Sc)},${Y(Sc)}" fill="rgba(20,20,30,0.38)"/>`;
    }
    if (ctx.s.gRod) {
      // an oversized rod (rodX times longer) casts rodX times the shadow; the dot below, where its notch's shadow falls, is the reading
      const k = ctx.s.rodX > 1 ? ctx.s.rodX : 1, Sr = [Sc[0] * k, Sc[1] * k];
      out += `<line x1="${X([0, 0])}" y1="${Y([0, 0])}" x2="${X(Sr)}" y2="${Y(Sr)}" stroke="rgba(20,20,30,0.45)" stroke-width="${f(Math.max(dial.L * 0.025, 1.5))}" stroke-linecap="round"/>`;
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
<svg xmlns="http://www.w3.org/2000/svg" ${INKSCAPE_NS} width="${f(sheet.W)}mm" height="${f(sheet.H)}mm" viewBox="0 0 ${f(sheet.W)} ${f(sheet.H)}">
${defs(sheet.bw, sheet.laser)}<style>${sheet.css}${sheetCss(sheet.bw, sheet.laser)}</style>
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
function dimV(y1, y2, x, xRef, text) { // text null: the line only (the value goes in a caption)
  const cx = x, cy = (y1 + y2) / 2;
  if (text == null) return `<path class="dimx" d="M${f(xRef)} ${f(y1)}H${f(x + Math.sign(x - xRef) * 2)}M${f(xRef)} ${f(y2)}H${f(x + Math.sign(x - xRef) * 2)}"/><path class="dim" d="M${f(x)} ${f(y1)}V${f(y2)}" marker-start="url(#arr)" marker-end="url(#arr)"/>`;
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
    `${ctx.place ? ctx.place + ' — ' : ''}${latLon(s)}, UTC${s.tz >= 0 ? '+' : ''}${s.tz} (${s.dst})`,
    `D = ${s.D.toFixed(1)}° ${t('dRef')} (${t('faces')} ${((180 + absoluteDeclination(s.lat, s.D) + 360) % 360).toFixed(1)}° N→E) · L = ${mm(dial.L)} · ${mm1(dial.plate.w)} × ${mm1(dial.plate.h)} mm`,
    `${t('SH')} ${a.SH.toFixed(2)}° · ${t('SD')} ${a.SD.toFixed(2)}° · ${t('DL')} ${a.DL.toFixed(2)}°`,
    systems,
  ];
}

/** The face sheet's line about F and R (title block). */
const footLine = (dial, s, t) => `F: ${t('foot').replace(/^F: /, '')}${dial.root && s.gPolar ? ` · R: ${t('root').replace(/^R: /, '')} (${dial.root[0].toFixed(1)}, ${dial.root[1].toFixed(1)}) mm` : ''}`;
const TITLE_CHAR_W = 1.95; // estimated width of one character of the 3.6 px title-block text, mm

const CHAR_W = 2.0; // estimated width of one character of a 3.5 px dimension label, mm

/**
 * Margins of the face sheet around the plate, sized to what is drawn there (dimension lines, their labels,
 * the title block) so the sheet is no bigger than it needs to be: every millimetre saved can save a
 * printed page. Label widths are estimated. A short vertical dimension puts its label to the right of its line.
 */
// Where the face sheet's dimension lines sit, mm outside the plate: the plate's own size, then F, then R (full caption only).
const DIM1 = 7, DIM2 = 14;
const KEY_FS = 3.2, KEY_CHAR_W = 1.75; // the laser key's text size (px = mm) and estimated width of one character, mm

/** The laser key (what its colours mean), wrapped to a sheet W mm wide with left margin ML, and the height it takes. */
function laserKey(t, W, ML) {
  const lines = wrapText(t('laserNote'), Math.max(30, Math.floor((W - ML - 8) / KEY_CHAR_W)));
  return { lines, h: lines.length * KEY_FS * 1.45 + 4 };
}
/** The style root in plate coordinates (mm from the plate's left and top edges), or null when the triangular style is not drawn. */
const rootOnPlate = (dial, s) => (dial.root && s.gPolar ? [dial.plate.fx + dial.root[0], dial.plate.fy - dial.root[1]] : null);
const latLon = (s) => `${Math.abs(s.lat).toFixed(4)}° ${s.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.lon).toFixed(4)}° ${s.lon >= 0 ? 'E' : 'W'}`;
const mm1 = (x) => String(+x.toFixed(1)); // 600, or 600.4 for a plate typed to the tenth

/** The short caption's lines: title, place and scale, and where F and R are on the plate (the numbers the dimension lines would give). */
function briefLines(dial, s, t) {
  const P = dial.plate;
  return [{ t: `${t('title')} — ${t('sheetFace')}`, b: true },
    `${latLon(s)} · D = ${s.D.toFixed(1)}° · L = ${mm(dial.L)} · ${mm1(P.w)} × ${mm1(P.h)} mm`,
    ...platePos(dial, s, t)];
}
/** ["F: x mm from the left edge, y mm from the top", "R: …"]: where the foot and the style root are on the plate. */
export const platePos = (dial, s, t) => {
  const P = dial.plate, R = rootOnPlate(dial, s);
  return [t('posF', P.fx.toFixed(1), P.fy.toFixed(1)), ...(R ? [t('posR', R[0].toFixed(1), R[1].toFixed(1))] : [])];
};

function faceMargins(dial, s) {
  const P = dial.plate;
  const R = rootOnPlate(dial, s);
  const brief = !!s.faceBrief; // short caption: no dimension lines and no scale bar (the positions are in the caption)
  const t = makeT(s.lang || 'en'), caption = brief ? briefLines(dial, s, t) : null;
  let left, top, right;
  if (brief) {
    left = 2; top = 2; right = 2;
  } else {
    // a long dimension's label runs along its line (about 3.5 mm beyond it); a short one's sits beside it
    const rightOf = (x, len, text) => x + (Math.abs(len) > 28 ? 2 : 1.5 + text.length * CHAR_W);
    right = rightOf(DIM1, P.fy, `F ${mm(P.fy)}`);
    left = DIM1 + 3.5; top = DIM1 + 3.8;
    if (R) right = Math.max(right, rightOf(DIM2, R[1], `R ${mm(R[1])}`));
  }
  if (R) { // the root, its circle and its letter may lie outside the plate
    right = Math.max(right, R[0] - P.w + 8);
    left = Math.max(left, 8 - R[0]);
    top = Math.max(top, 6 - R[1]);
  }
  // the title block's width, estimated from its longest line (the place name, unknown here, gets 20 characters)
  const textW = TITLE_CHAR_W * (brief ? Math.max(...caption.map((l) => (l.t || l).length))
    : Math.max(...summaryLines(dial, { s, t, place: '' }).map((l, i) => l.length + (i ? 0 : 20)), footLine(dial, s, t).length));
  const barBelow = !brief && textW + 8 > P.w - 100; // the scale bar's left end is 100 mm left of the plate's right edge
  // bottom: the caption starts just below the plate (brief) or below the F and R dimensions; its height follows its lines
  const m = { L: Math.ceil(left + 4), T: Math.ceil(top + 4), R: Math.ceil(right + 4) };
  m.R = Math.max(m.R, Math.ceil(textW + 6 - P.w), barBelow ? 110 - P.w : 0); // room for the title block, and for the bar under it
  // a laser sheet adds the key to its colours, wrapped to the sheet's width; its height follows its lines
  const key = s.material === 'laser' ? laserKey(t, P.w + m.L + m.R, m.L) : null;
  const keyH = key ? key.h : 0;
  const B = brief ? 8 + (caption.length - 1) * 3.6 * 1.45 + 4 + keyH : DIM2 + 12 + 6 * 3.6 * 1.45 + 6 + (barBelow ? 22 : 0) + keyH;
  return { ...m, B: Math.ceil(B), barBelow, key, caption };
}

/** Size of the face sheet in mm, without rendering it. s: the settings (what is drawn, the language of the title block). */
export function faceSheetSize(dial, s) {
  const m = faceMargins(dial, s);
  return { W: dial.plate.w + m.L + m.R, H: dial.plate.h + m.T + m.B };
}

export function faceSheet(dial, ctx) {
  const { s, t } = ctx;
  const P = dial.plate;
  const { sw } = sizesFor(s.material, P);
  const { L: ML, T: MT, R: MR, B: MB, barBelow, key, caption } = faceMargins(dial, s);
  const W = P.w + ML + MR, H = P.h + MT + MB;
  let g = dialMarkup(dial, ctx);
  if (s.material !== 'laser') {
    g += `<path class="l-construct" d="M${f(P.fx)} 0V${f(P.h)}"/>`;
    g += `<text class="dt" x="${f(P.fx + 2.5)}" y="${f(P.h * 0.04 + 10)}" transform="rotate(-90 ${f(P.fx + 2.5)} ${f(P.h * 0.04 + 10)})" style="text-anchor:end">${esc(t('plumb'))}</text>`;
    g += `<text class="dt" x="${f(P.fx - 3)}" y="${f(P.fy - 3)}" style="text-anchor:end">F</text>`;
  }
  // dimensions, close to the plate (the short caption gives the positions in words instead)
  if (!s.faceBrief) {
    g += dimH(0, P.w, -DIM1, 0, mm(P.w));
    g += dimV(0, P.h, -DIM1, 0, mm(P.h));
    g += dimH(0, P.fx, P.h + DIM1, P.h, `F ${mm(P.fx)}`);
    g += dimV(0, P.fy, P.w + DIM1, P.w, `F ${mm(P.fy)}`);
  }
  const root = rootOnPlate(dial, s);
  if (root) {
    const [rx, ry] = root;
    if (s.material !== 'laser') g += `<text class="dt" x="${f(rx + 3)}" y="${f(ry - 3)}" style="text-anchor:start">R</text>`;
    if (!s.faceBrief) {
      g += dimH(0, rx, P.h + DIM2, P.h, `R ${mm(rx)}`);
      g += dimV(0, ry, P.w + DIM2, P.w, `R ${mm(ry)}`);
    }
  }
  const laser = s.material === 'laser';
  // a laser file has one layer per job (cut, score, engrave, notes); everything else is one drawing
  const done = (notes) => ({ W, H, inner: laser ? laserArrows(laserLayers([[g, `translate(${ML},${MT})`], [notes]])) : `<g transform="translate(${ML},${MT})">${g}</g>${notes}`, css: dialCss(s.material, sw, s.ink === 'bw'), name: 'face', bw: s.ink === 'bw', laser });
  // title block
  if (s.faceBrief) {
    const y0 = MT + P.h + 8;
    return done(textLines(ML, y0, caption, 3.6) + (key ? textLines(ML, y0 + caption.length * 3.6 * 1.45, key.lines, KEY_FS) : ''));
  }
  const ty = MT + P.h + DIM2 + 12;
  let inner = textLines(ML, ty, [{ t: `${t('title')} — ${t('sheetFace')}`, b: true }, ...summaryLines(dial, ctx),
    footLine(dial, s, t),
    `${t('generated')}: ${ctx.dateStr || ''}`], 3.6);
  // 100 mm scale bar
  const LN = key ? key.h : 0; // a laser sheet keeps a strip at the bottom for the key to its colours
  const sx = barBelow ? ML : W - MR - 100, sy = H - 14 - LN;
  let bar = `<path class="dim" d="M${sx} ${sy}H${sx + 100}"/>`;
  for (let i = 0; i <= 10; i++) bar += `<path class="dim" d="M${sx + i * 10} ${sy}V${sy - (i % 5 === 0 ? 4 : 2)}"/>`;
  bar += `<text class="dt" x="${sx}" y="${sy - 5.5}">0</text><text class="dt" x="${sx + 50}" y="${sy - 5.5}">50</text><text class="dt" x="${sx + 100}" y="${sy - 5.5}">100 mm</text>`;
  bar += `<text class="dt" x="${sx + 50}" y="${sy + 5}">${esc(t('scale'))}</text>`;
  inner += bar;
  if (key) inner += textLines(ML, H - LN + 4, key.lines, KEY_FS);
  return done(inner);
}

export function gnomonSheet(dial, ctx) {
  const { s, t } = ctx;
  const L = dial.L, M = 14, TAB = 15, laser = s.material === 'laser';
  let inner = '', x = M, H = 0;
  let right = M + 150; // right edge of the drawing (estimated), so the sheet is no wider than needed; 150 mm for the summary lines
  const top = M + 12;
  inner += textLines(M, M, [{ t: `${t('title')} — ${t('sheetGnomon')}`, b: true }], 5);
  if (s.gPolar && dial.root) {
    // Oversized (rodX > 1): the whole triangle is rodX times bigger, so it is easy to cut and holds its shape; the notch on the
    // hypotenuse sits where the real nodus N would be (the original triangle's tip). Shadows scale about R, so the shadow of the
    // notch lands on the true point and the edge's shadow, the hour line, is just longer.
    const kP = s.rodX > 1 ? s.rodX : 1;
    const a1 = Math.hypot(dial.root[0], dial.root[1]), hyp1 = Math.hypot(a1, L);
    const a = kP * a1, LP = kP * L, hyp = kP * hyp1;
    const SH = Math.atan2(L, a1) * 180 / Math.PI;
    const ox = x, oy = top + LP + 10; // R' at (ox, oy)
    const tb = Math.min(TAB, a / 4);
    const ND = 3, d = [a1 / hyp1, -L / hyp1], nIn = [L / hyp1, a1 / hyp1]; // along the hypotenuse (up and right); notch depth, into the triangle
    const Nx = ox + a1, Ny = oy - L; // the true nodus, on the hypotenuse
    const P = (px, py) => `${f(px)},${f(py)}`;
    const notch = kP > 1 ? ` ${P(Nx - 3 * d[0], Ny - 3 * d[1])} ${P(Nx + ND * nIn[0], Ny + ND * nIn[1])} ${P(Nx + 3 * d[0], Ny + 3 * d[1])}` : '';
    // a laser cuts the outline of triangle and tab in one piece (the fold is only scored); a paper template shows the two parts
    let g = laser ? `<polygon class="cut" points="${P(ox, oy)}${notch} ${P(ox + a, oy - LP)} ${P(ox + a, oy)} ${P(ox + a - tb, oy + tb)} ${P(ox + tb, oy + tb)}"/>`
      : `<polygon class="cut" points="${P(ox, oy)}${notch} ${P(ox + a, oy - LP)} ${P(ox + a, oy)}"/>` +
        `<polygon class="cut" points="${f(ox)},${f(oy)} ${f(ox + a)},${f(oy)} ${f(ox + a - tb)},${f(oy + tb)} ${f(ox + tb)},${f(oy + tb)}"/>`;
    g += `<path class="fold" d="M${f(ox)} ${f(oy)}H${f(ox + a)}"/>`;
    const r = Math.min(a, LP, 60) * 0.35;
    g += `<path class="dim" d="M${f(ox + r)} ${f(oy)}A${f(r)} ${f(r)} 0 0 0 ${f(ox + r * Math.cos(SH * Math.PI / 180))} ${f(oy - r * Math.sin(SH * Math.PI / 180))}"/>`;
    g += `<text class="dt" x="${f(ox + r + 6)}" y="${f(oy - 2)}" style="text-anchor:start">${SH.toFixed(2)}°</text>`;
    const extra = kP > 1 ? 10 : 0; // when oversized, a dimension line from R to the true foot F comes first, the whole base under it
    if (kP > 1) g += `<path class="dimx" d="M${f(Nx)} ${f(oy)}V${f(oy + tb)}"/>` + dimH(ox, Nx, oy + tb + 9, oy + tb, `R–F = ${mm(a1)}`);
    g += dimH(ox, ox + a, oy + tb + 9 + extra, oy + tb, mm(a));
    g += dimV(oy - LP, oy, ox + a + 10, ox + a, kP > 1 ? `${kP}×L = ${mm(LP)}` : `L = ${mm(L)}`);
    // the edge label goes along the hypotenuse (past the notch when oversized) if it is long enough, else in the caption below
    const edgeLabel = `${t('styleEdge')} — ${mm(hyp)}`, t0 = kP > 1 ? 1 / kP : 0, span = hyp * (1 - t0);
    if (span > edgeLabel.length * 1.8 + 10) {
      const mx = ox + a * (1 + t0) / 2, my = oy - LP * (1 + t0) / 2;
      g += `<text class="dt" x="${f(mx - 3)}" y="${f(my - 3)}" transform="rotate(${f(-SH)} ${f(mx - 3)} ${f(my - 3)})">${esc(edgeLabel)}</text>`;
    } else {
      g += `<text class="dt" x="${f(ox)}" y="${f(oy + tb + 25 + extra)}" style="text-anchor:start">${esc(edgeLabel)}</text>`;
    }
    g += `<text class="dt" x="${f(ox - 3)}" y="${f(oy + 1)}" style="text-anchor:end">R</text>`;
    g += `<text class="dt" x="${f(ox + a + 3)}" y="${f(oy + 4)}" style="text-anchor:start">${kP > 1 ? 'F′' : 'F'}</text>`;
    if (kP > 1) g += `<text class="dt" x="${f(Nx - 6)}" y="${f(Ny - 4)}" style="text-anchor:end">N (${esc(t('nodus'))}) = ${esc(t('rodNotch'))}</text>`;
    else g += `<text class="dt" x="${f(ox + a + 3)}" y="${f(oy - LP - 2)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    g += `<circle cx="${f(Nx)}" cy="${f(Ny)}" r="1" class="nodus"/>`;
    g += `<text class="dt" x="${f(kP > 1 ? ox + (a1 + a) / 2 : ox + a / 2)}" y="${f(oy + tb / 2 + 1)}">${esc(t('tab'))}</text>`;
    g += `<text class="dt" x="${f(ox)}" y="${f(oy + tb + 20 + extra)}" style="text-anchor:start">${esc(t('wallEdge'))}</text>`;
    H = Math.max(H, oy + tb + 27 + extra); // the bottom of the captions under the tab
    if (kP > 1) {
      const lines = wrapText(t('polarLongNote', kP), 60);
      g += textLines(ox, oy + tb + 31 + extra, lines, 3.2);
      H = Math.max(H, oy + tb + 31 + extra + lines.length * 3.2 * 1.45);
    }
    inner += g;
    x += a + 36;
    right = Math.max(right, ox + a + 24);
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
    const h = dial.bladeH, tb = Math.min(TAB, L / 4, h / 3); // a low blade gets a narrower tab (its slanted ends must not cross)
    const bx = x + TAB + 10, ay = top + 10, fy = ay + h;
    const hShort = h <= 28; // a short height dimension would put its label to the left of the line, off the sheet: it goes in the caption
    const tip = Math.atan2(h, L) * 180 / Math.PI, th = tip * Math.PI / 180;
    let g = laser ? `<polygon class="cut" points="${f(bx)},${f(ay)} ${f(bx - tb)},${f(ay + tb)} ${f(bx - tb)},${f(fy - tb)} ${f(bx)},${f(fy)} ${f(bx + L)},${f(fy)}"/>`
      : `<polygon class="cut" points="${f(bx)},${f(ay)} ${f(bx)},${f(fy)} ${f(bx + L)},${f(fy)}"/>` +
        `<polygon class="cut" points="${f(bx)},${f(ay)} ${f(bx)},${f(fy)} ${f(bx - tb)},${f(fy - tb)} ${f(bx - tb)},${f(ay + tb)}"/>`;
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
    g += dimV(ay, fy, bx - tb - 10, bx - tb - 1, hShort ? null : `h = ${mm(h)}`);
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
    if (hShort) caption.push(`h = ${mm(h)}`);
    if (!roomy) caption.push(`${t('bladeTop')}: ↑ · ${tip.toFixed(1)}° · ${t('bladeBrace')} ${mm(Math.hypot(L, h))}`);
    if (!tabFits) caption.push(t('bladeTabAt'));
    const bladeLines = [...caption, ...wrapText(`${t('blade')}: ${t('bladeNote')}`, 52)];
    inner += textLines(bx - tb, fy + 22, bladeLines, 3.2);
    x += Math.max(TAB + L + 70, 115);
    right = Math.max(right, bx + L + 24, bx - tb + 90);
    H = Math.max(H, fy + 22 + bladeLines.length * 3.2 * 1.45); // the bottom of the caption
  }
  const kRod = s.gRod && s.rodX > 1 ? s.rodX : 1;
  if (kRod > 1) {
    // Oversized rod: rodX times longer than needed, lying along the bottom of the sheet. Its shadow on the wall is a long line
    // from F (every point of the rod casts its shadow in proportion to its distance from the wall), so the direction is easy
    // to read; the notch, L from the wall, throws its shadow exactly where the true nodus would.
    const EMB = 30, WD = 6, ND = 2.5, len = kRod * L;
    const x0 = M + 6, xf = x0 + len, xe = xf + EMB, xn = xf - L, oy = Math.max(H, top) + 16, my = oy + WD / 2;
    let g = `<polygon class="cut" points="${f(x0)},${f(oy)} ${f(xn - 3)},${f(oy)} ${f(xn)},${f(oy + ND)} ${f(xn + 3)},${f(oy)} ${f(xe)},${f(oy)} ${f(xe)},${f(oy + WD)} ${f(xn + 3)},${f(oy + WD)} ${f(xn)},${f(oy + WD - ND)} ${f(xn - 3)},${f(oy + WD)} ${f(x0)},${f(oy + WD)}"/>`;
    g += `<path class="fold" d="M${f(xf)} ${f(oy - 4)}V${f(oy + WD + 4)}"/>`;
    g += `<circle cx="${f(x0)}" cy="${f(my)}" r="1.2" class="nodus"/>`;
    g += `<text class="dt" x="${f(x0)}" y="${f(oy - 3)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    g += `<text class="dt" x="${f(xn)}" y="${f(oy - 3)}">${esc(t('rodNotch', mm(L)))}</text>`;
    g += `<text class="dt" x="${f(xf + 3)}" y="${f(oy - 3)}" style="text-anchor:start">${EMB} mm ${esc(t('rodEmbed'))}</text>`;
    g += dimH(x0, xf, oy + WD + 9, oy + WD, `${kRod}× = ${mm(len)}`);
    g += dimH(xn, xf, oy + WD + 19, oy + WD, `L = ${mm(L)}`);
    const longLines = wrapText(`${t('rod')}: ${t('rodLongNote', kRod)}`, 90);
    g += textLines(x0, oy + WD + 28, longLines, 3.4);
    inner += g;
    right = Math.max(right, xe + 4, xf + 3 + (`${EMB} mm ${t('rodEmbed')}`).length * CHAR_W);
    H = Math.max(H, oy + WD + 28 + longLines.length * 3.4 * 1.45);
  } else if (s.gRod || (s.gPolar && !dial.root)) {
    const EMB = 30, ox = x + 10, oy = top + 10;
    let g = `<rect class="cut" x="${f(ox - 2)}" y="${f(oy)}" width="4" height="${f(L + EMB)}"/>`;
    g += `<path class="fold" d="M${f(ox - 10)} ${f(oy + L)}H${f(ox + 10)}"/>`;
    g += `<circle cx="${f(ox)}" cy="${f(oy)}" r="1.2" class="nodus"/>`;
    g += dimV(oy, oy + L, ox + 14, ox + 2, `L = ${mm(L)}`);
    g += `<text class="dt" x="${f(ox + 6)}" y="${f(oy + L + EMB / 2)}" style="text-anchor:start">${EMB} mm ${esc(t('rodEmbed'))}</text>`;
    g += `<text class="dt" x="${f(ox + 6)}" y="${f(oy - 3)}" style="text-anchor:start">N (${esc(t('nodus'))})</text>`;
    const rodLines = wrapText(`${t('rod')}: ${t('rodNote')}`, 38);
    g += textLines(ox - 2, oy + L + EMB + 6, rodLines, 3.5);
    inner += g;
    right = Math.max(right, ox + 30, ox - 2 + 38 * 1.9);
    H = Math.max(H, oy + L + EMB + 6 + rodLines.length * 3.5 * 1.45); // the bottom of the caption
  }
  const W = Math.max(Math.ceil(right + 12), 180);
  // the summary sits just below the drawing, so the sheet is no taller than it needs to be (it should fit an A4 page)
  inner += textLines(M, H + 6, summaryLines(dial, ctx).slice(0, 3), 3.2);
  H = Math.ceil(H + 6 + 2 * 3.2 * 1.45 + 5);
  if (laser) inner = laserArrows(laserLayers([[inner]]));
  return { W, H, inner, css: '', name: 'gnomon', bw: s.ink === 'bw', laser };
}

export const fmtMin = (m) => {
  const sgn = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  const mi = Math.floor(a), se = Math.round((a - mi) * 60);
  return `${sgn}${se === 60 ? mi + 1 : mi} m ${String(se === 60 ? 0 : se).padStart(2, '0')} s`;
};

export function infoSheet(dial, ctx) {
  const { s, t } = ctx;
  const W = 186, x = 10; // fits an A4 page inside a printer margin of up to 12 mm; the height follows the content
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
    dial.root ? t('rootLine', dial.root[0].toFixed(1), dial.root[1].toFixed(1), Math.hypot(...dial.root).toFixed(1)) : t('noPolar'),
    platePos(dial, s, t).join(' · '),
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
      const i = dayOfYear(mo, day);
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
  // a "nice" grid step that keeps the number of lines readable whatever the range (a very wrong time zone gives hundreds of minutes)
  const raw = Math.max(...all, 0) - Math.min(...all, 0) + 4; // the data plus the padding below
  const step = [5, 10, 20, 50, 100, 200, 500].find((s) => raw / s <= 8) || 1000;
  const lo = Math.floor((Math.min(...all, 0) - 2) / step) * step, hi = Math.ceil((Math.max(...all, 0) + 2) / step) * step;
  const Xt = (days) => px + (days / n) * pw; // days since the start of the year (fractions allowed)
  const X = (day) => Xt(day + 0.5); // the point of day i is its noon, half a day into the day
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
  const first = (m) => dayOfYear(m, 1);
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
  const sepMm = Math.max(...data.map((d) => Math.abs(d.solar - d.zone))) * (ph / (hi - lo)); // distance between the curves on the sheet
  for (const [key, cls] of [['solar', 'cg-solar-dot'], ['zone', 'cg-zone-dot']]) {
    if (key === 'zone' && sepMm < 7) continue; // the curves coincide or are too close for two sets of labels (each is about 5 mm tall with its gap): one set is enough
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
  return { markup: `<g>${g}</g>`, X, Xt, Y, lo, hi, box: { px, py, pw, ph } };
}

/**
 * "Today" on the chart: a vertical line and a dot on each curve. days: time since the start of the year, in days
 * (so local noon on the third of January is 2.5, which is where that day's point of the curve is).
 */
export function correctionMarker(graph, days, solar, zone) {
  const cx = graph.Xt(days), cl = (v) => Math.min(graph.hi, Math.max(graph.lo, v));
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
  // the note about marked months only makes sense where summer time exists
  const notes = [t(data.some((d) => d.dst) ? 'cgHow' : 'cgHowNoDst'), t('cgLon', signed1(lonCorrection(s.lon, s.tz)))].flatMap((n) => wrapText(n, 130));
  inner += textLines(x, gy + gh + 8, notes, 3.4);
  const H = Math.ceil(gy + gh + 8 + notes.length * 3.4 * 1.45 + 4);
  const bw = s.ink === 'bw';
  return { W, H, inner, css: graphCss(bw), name: 'correction', bw }; // the chart's own CSS: no other sheet needs it
}

// ---------------- When the sun reaches the wall ----------------

/** CSS of the sun chart on the page: theme colours from style.css (--sun-*), so light and dark each get their own steps. */
export function sunChartCss() {
  return `.sc-t{font-family:Helvetica,Arial,sans-serif;font-size:3.2px;fill:var(--ink)}.sc-axis{stroke:var(--muted);stroke-width:0.3;fill:none}` +
    `.sc-grid{stroke:var(--line);stroke-width:0.15;fill:none}.sc-4{fill:var(--sun-lit)}.sc-3{fill:var(--sun-graze)}.sc-1{fill:var(--sun-behind)}` +
    `.sc-2{fill:var(--sun-hidden)}.sc-hatch{stroke:var(--sun-hatch);stroke-width:0.35}.sc-dst{fill:var(--muted)}.sc-now{stroke:var(--accent);stroke-width:0.45;fill:none}`;
}

/**
 * Chart of when the sun reaches the wall: date across (one column per grid column), standard clock time down, each cell
 * coloured by its SUN state (night left blank; the hidden state also hatched, so it does not rely on colour). Only the
 * hours in which the sun is ever up are drawn. dst: per-day summer-time flags (yearCorrections), drawn as a strip on top.
 * Returns { markup, X(days), Y(minutes), box, t0, t1 }.
 */
export function sunChart(grid, { x = 0, y = 0, w = 262, h = 120, t, dst = [], grazing = 0 }) {
  const { cols, n, stepMin, stepDays } = grid, months = t('monthsShort');
  // legend: a swatch and a label for each state that occurs (and the summer-time strip), wrapped into rows
  const seen = new Set(cols.flatMap((c) => [...new Set(c.codes)]));
  const runs = [];
  dst.forEach((d, i) => { if (d.dst) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); } });
  const items = [[4, t('sunLit')], [3, t('sunGraze', grazing)], [1, t('sunBehind')], [2, t('sunHidden')]].filter(([v]) => seen.has(v));
  if (runs.length) items.push(['dst', t('sunDst')]);
  const legend = [];
  let lx = x + 12, row = 0;
  for (const [v, label] of items) {
    const iw = 6.5 + label.length * 1.6 + 4; // swatch, label (estimated at 1.6 mm a character), gap
    if (lx + iw > x + w && lx > x + 12) { lx = x + 12; row++; }
    legend.push([v, label, lx, y + row * 4.8]);
    lx += iw;
  }
  const px = x + 12, py = y + 12 + row * 4.8, pw = w - 12 - 3, ph = h - (py - y) - 7;
  let k0 = n, k1 = 0;
  for (const c of cols) for (let k = 0; k < n; k++) if (c.codes[k]) { k0 = Math.min(k0, k); k1 = Math.max(k1, k + 1); }
  if (k1 <= k0) { k0 = 0; k1 = n; }
  const t0 = Math.floor(k0 * stepMin / 60) * 60, t1 = Math.ceil(k1 * stepMin / 60) * 60; // whole hours, minutes
  const Xt = (days) => px + (days / 365) * pw, Y = (min) => py + ((min - t0) / (t1 - t0)) * ph;
  let g = '<defs><pattern id="sunHatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path class="sc-hatch" d="M0 0V1.6"/></pattern></defs>';
  // the cells, merged into runs down each column
  g += '<g shape-rendering="crispEdges">'; // no hairline seams between the columns
  for (const c of cols) {
    const xa = Xt(c.i), xb = Xt(Math.min(365, c.i + stepDays));
    for (let k = 0; k < n;) {
      const v = c.codes[k];
      let e = k + 1;
      while (e < n && c.codes[e] === v) e++;
      if (v) {
        const r = `x="${f(xa)}" y="${f(Y(k * stepMin))}" width="${f(xb - xa + 0.05)}" height="${f(Y(e * stepMin) - Y(k * stepMin))}"`;
        g += `<rect class="sc-${v}" ${r}/>`;
        if (v === 2) g += `<rect fill="url(#sunHatch)" ${r}/>`;
      }
      k = e;
    }
  }
  g += '</g>';
  // hours down the left (every 2 h), months along the bottom
  for (let m = t0; m <= t1; m += 60) {
    if ((m / 60) % 2) continue;
    g += `<path class="sc-grid" d="M${f(px)} ${f(Y(m))}H${f(px + pw)}"/><text class="sc-t" x="${f(px - 1.5)}" y="${f(Y(m) + 1.1)}" style="text-anchor:end">${fmtHM(m)}</text>`;
  }
  const first = (mo) => dayOfYear(mo, 1);
  for (let mo = 0; mo < 12; mo++) {
    const a = first(mo), b = mo < 11 ? first(mo + 1) : 365;
    if (mo) g += `<path class="sc-grid" d="M${f(Xt(a))} ${f(py)}V${f(py + ph)}"/>`;
    g += `<text class="sc-t" x="${f(Xt((a + b) / 2))}" y="${f(py + ph + 4.5)}" style="text-anchor:middle">${esc(months[mo])}</text>`;
  }
  g += `<path class="sc-axis" d="M${f(px)} ${f(py)}V${f(py + ph)}H${f(px + pw)}"/>`;
  // summer time: a thin strip above the plot
  for (const [a, b] of runs) g += `<rect class="sc-dst" x="${f(Xt(a))}" y="${f(py - 2.2)}" width="${f(Xt(b + 1) - Xt(a))}" height="1.2"/>`;
  for (const [v, label, lx, ly] of legend) {
    g += v === 'dst' ? `<rect class="sc-dst" x="${f(lx)}" y="${f(ly + 2.2)}" width="5" height="1.2"/>`
      : `<rect class="sc-${v}" x="${f(lx)}" y="${f(ly + 1)}" width="5" height="3.2"/>${v === 2 ? `<rect fill="url(#sunHatch)" x="${f(lx)}" y="${f(ly + 1)}" width="5" height="3.2"/>` : ''}`;
    g += `<text class="sc-t" x="${f(lx + 6.5)}" y="${f(ly + 3.7)}">${esc(label)}</text>`;
  }
  return { markup: `<g>${g}</g>`, X: Xt, Y, box: { px, py, pw, ph }, t0, t1 };
}

/**
 * The simulated moment on the sun chart: days since the start of the year, standard-time minutes after midnight. A time
 * outside the plotted hours (night) gets only the date line, not a point on the chart's edge.
 */
export function sunChartMarker(chart, days, min) {
  const { px, py, pw, ph } = chart.box, cx = chart.X(Math.min(365, Math.max(0, days)));
  let out = `<path class="sc-now" d="M${f(cx)} ${f(py)}V${f(py + ph)}"/>`;
  if (min >= chart.t0 && min <= chart.t1) { const cy = chart.Y(min); out += `<path class="sc-now" d="M${f(px)} ${f(cy)}H${f(px + pw)}"/><circle class="sc-now" cx="${f(cx)}" cy="${f(cy)}" r="1.4"/>`; }
  return out;
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
 * Plan the pages of one sheet. Neighbouring pages overlap, and the alignment marks sit at the centres of
 * the overlap zones so they coincide on two neighbouring pages. Returns null if there is no layout, else
 * { lay, sheet, content, page(i, j, shared) }: page() builds one page. A self-contained page carries the whole
 * sheet (for a download); a shared page only refers to `content`, which the caller defines once for all of the
 * sheet's pages (a print job: hundreds of pages would otherwise mean hundreds of copies of the sheet).
 * opts.t: translator for the page label (default English).
 */
function planTiles(sheet, paper, overlap, label, opts) {
  const lay = tileLayout(sheet.W, sheet.H, paper, overlap, opts);
  if (!lay) return null;
  const { pw, ph, aw, ah, nx, ny, sx, sy, tw, th, margin: pm, header, orient, overlap: ov, pages } = lay;
  const t = opts.t || makeT('en');
  let regs = '';
  if (pages > 1) {
    const at = (n, step, len) => (n === 1 ? [ov / 2, len - ov / 2] : Array.from({ length: n + 1 }, (_, k) => k * step + ov / 2));
    for (const cx of at(nx, sx, sheet.W)) for (const cy of at(ny, sy, sheet.H)) {
      regs += `<circle class="reg" cx="${f(cx)}" cy="${f(cy)}" r="3"/><path class="reg" d="M${f(cx - 5)} ${f(cy)}H${f(cx + 5)}M${f(cx)} ${f(cy - 5)}V${f(cy + 5)}"/>`;
    }
  }
  const px = pm + (aw - tw) / 2, py = pm + header + (ah - th) / 2; // where a tile starts on the page
  const contentId = `content-${sheet.name}`;
  const content = `<g id="${contentId}">${sheet.inner}${regs}</g>`;
  const page = (i, j, shared) => {
    const x0 = nx === 1 ? 0 : i * sx, y0 = ny === 1 ? 0 : j * sy;
    const vx = x0 - px, vy = y0 - py; // sheet coordinates of the page's top-left corner
    const id = `clip-${sheet.name}-${i}-${j}`, n = j * nx + i + 1; // unique across sheets: several are printed in one document
    const parts = [pages > 1 && t('pageOf', n, pages, j + 1, ny, i + 1, nx), `${paper} ${t(orient === 'portrait' ? 'orientPortrait' : 'orientLandscape')}`, ov && t('pageOverlap', f(ov)), t('pageMargin', f(pm))];
    const note = `${label} — ${parts.filter(Boolean).join(' · ')}`;
    const body = `<clipPath id="${id}"><rect x="${f(x0)}" y="${f(y0)}" width="${f(tw)}" height="${f(th)}"/></clipPath>
<g clip-path="url(#${id})">${shared ? `<use href="#${contentId}"/>` : sheet.inner + regs}</g>
<rect class="tileb" x="${f(x0)}" y="${f(y0)}" width="${f(tw)}" height="${f(th)}"/>
<text class="dt" x="${f(vx + pm)}" y="${f(vy + pm + 4.5)}" style="text-anchor:start">${esc(note)}</text>`;
    const head = `<svg xmlns="http://www.w3.org/2000/svg" ${INKSCAPE_NS} width="${pw}mm" height="${ph}mm" viewBox="${f(vx)} ${f(vy)} ${pw} ${ph}">`;
    const svg = shared ? `${head}${body}</svg>`
      : `<?xml version="1.0" encoding="UTF-8"?>\n${head}\n${defs(sheet.bw, sheet.laser)}<style>${sheet.css}${sheetCss(sheet.bw, sheet.laser)}</style>${body}</svg>`;
    return { name: tileName(sheet.name, i, j), svg, pw, ph, page: n, pages, orient, sheet: sheet.name };
  };
  return { lay, sheet, content, page };
}

/**
 * Cut a sheet into printable pages (see tileLayout for opts). Returns [{ name, svg, pw, ph, page, pages, orient }],
 * each page a self-contained SVG. opts.only: build just that page (0-based, row by row) and no other.
 */
export function tileSheets(sheet, paper, overlap, label, opts = {}) {
  const plan = planTiles(sheet, paper, overlap, label, opts);
  if (!plan) return [];
  const { nx, ny } = plan.lay, out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (opts.only == null || opts.only === j * nx + i) out.push(plan.page(i, j, false));
  return out;
}

/** More pages than this in one print job: ask first (it is a lot of paper). */
export const MAX_QUIET_PAGES = 60;

/** Number of pages of a print job: sheets = [[sheet, label], ...]. */
export function printJobPages(sheets, paper, overlap, opts = {}) {
  return sheets.reduce((n, [sheet]) => n + (tileLayout(sheet.W, sheet.H, paper, overlap, opts)?.pages || 0), 0);
}

/**
 * The HTML document of a print job: every page of every sheet, one after the other. Each page asks for its own
 * paper size (CSS named pages), so a landscape dial and a portrait info sheet can share one job. A sheet's
 * content is defined once and its pages refer to it, so the document stays small however many pages there are.
 * Returns '' when nothing can be printed.
 */
export function printJobHtml(sheets, paper, overlap, opts, title) {
  const plans = sheets.map(([sheet, label]) => planTiles(sheet, paper, overlap, label, opts)).filter(Boolean);
  const pages = plans.flatMap((p) => { const out = []; for (let j = 0; j < p.lay.ny; j++) for (let i = 0; i < p.lay.nx; i++) out.push(p.page(i, j, true)); return out; });
  if (!pages.length) return '';
  const sizes = [...new Set(pages.map((p) => `${p.pw}x${p.ph}`))];
  const css = `@page{size:${pages[0].pw}mm ${pages[0].ph}mm;margin:0}` +
    sizes.map((z) => { const [pw, ph] = z.split('x'); return `@page p${z}{size:${pw}mm ${ph}mm;margin:0}`; }).join('') +
    'html,body{margin:0}.pg{break-after:page;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pg svg{display:block}';
  // each sheet's styles only reach its own content and pages (a laser gnomon and a paper info sheet style .cut differently)
  const markers = [...new Set(plans.map((p) => defs(p.sheet.bw, p.sheet.laser)))].join('');
  const holder = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${markers}` +
    plans.map((p) => `<style>${scopeCss(p.sheet.css + sheetCss(p.sheet.bw, p.sheet.laser), [`#content-${p.sheet.name}`, `.pg-${p.sheet.name}`])}</style><defs>${p.content}</defs>`).join('') + '</svg>';
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style>${holder}` +
    pages.map((p) => `<div class="pg pg-${p.sheet}" style="page:p${p.pw}x${p.ph};width:${p.pw}mm;height:${p.ph}mm">${p.svg}</div>`).join('') +
    '<script>onload=()=>print()</script>';
}

