// Build the static site into _site/ and pre-render sample plans (no dependencies).
//   node tools/build.mjs [outDir]
// The page itself needs no build; this only bundles files for the CI artifact
// and generates example SVGs with the default settings (Rome, south-west wall)
// plus a "showcase" variant with every option enabled.

import { mkdirSync, cpSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, sanitize, buildDial, PRESETS } from '../js/state.js';
import { faceSheet, gnomonSheet, infoSheet, svgDoc, tileSheets } from '../js/svg.js';
import { makeT } from '../js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, '_site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of ['index.html', 'css', 'js']) cpSync(join(root, p), join(out, p), { recursive: true });
if (existsSync(join(root, 'README.md'))) cpSync(join(root, 'README.md'), join(out, 'README.md'));

const variants = {
  'rome-sw-default': {},
  'rome-sw-it-clock': { lang: 'it', hZone: true, hDstLabels: true, anaHours: true, anaMeanNoon: false, xItalian: true },
  'rome-sw-showcase': {
    hZone: true, hDstLabels: true, anaZoneNoon: true, dZodiac: true, xItalian: true, xBabylonian: true,
    xAzimuth: true, motto: 'Horas non numero nisi serenas', paper: 'A4',
  },
  'rome-sw-laser': { material: 'laser' },
  'london-south': { place: 'london', ...PRESETS.london, D: 0 },
};

const plans = join(out, 'plans');
mkdirSync(plans, { recursive: true });
const dateStr = new Date().toISOString().slice(0, 10);
const index = [];
for (const [name, v] of Object.entries(variants)) {
  const { s } = sanitize({ ...DEFAULTS, ...v });
  const t = makeT(s.lang);
  const dial = buildDial(s, t);
  const ctx = { s, t, place: PRESETS[s.place]?.name || '', dateStr };
  const sheets = [faceSheet(dial, ctx), gnomonSheet(dial, ctx), infoSheet(dial, ctx)];
  for (const sh of sheets) {
    const file = `${name}-${sh.name}.svg`;
    writeFileSync(join(plans, file), svgDoc(sh));
    index.push(file);
  }
  if (s.paper !== 'none') {
    for (const tile of tileSheets(sheets[0], s.paper, s.overlap, `${name} face`)) {
      const file = `${name}-${tile.name}.svg`;
      writeFileSync(join(plans, file), tile.svg);
      index.push(file);
    }
  }
  console.log(`${name}: L=${dial.L} mm, warnings=${dial.warnings.map((w) => w[0]).join(',') || 'none'}`);
}
writeFileSync(join(plans, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Sample plans</title>
<style>body{font-family:system-ui,sans-serif;margin:16px}img{max-width:100%;border:1px solid #ccc;background:#fff}li{margin:1em 0}</style>
<h1>Sample plans</h1><p>Generated ${dateStr} by tools/build.mjs. <a href="../index.html">Open the interactive page</a>.</p>
<ul>${index.map((f) => `<li><a href="${f}">${f}</a><br><img src="${f}" loading="lazy" alt="${f}"></li>`).join('')}</ul>`);
console.log(`Wrote site and ${index.length} plans to ${out}`);
