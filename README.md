# Wall sundial generator

Design a **vertical declining wall sundial** for any latitude and wall orientation:

- interactive simulation of the shadow, live or at any chosen moment, with day/year animation and a 3D view;
- explanation of the mathematics, with the numbers for your settings;
- downloadable, dimensioned **SVG plans** in real millimetres: dial face, gnomon template, and a mounting/time-correction sheet, optionally split into A4/A3/A2 pages with registration marks.

Defaults: Rome (41.9028° N, 12.4964° E), wall facing south-west (D = 45°).

Every design choice is a checkbox, so you can compare options on the page:

| Group | Options |
|---|---|
| Hour lines | apparent solar time · zone time with longitude correction · half/quarter hours · Roman numerals · summer-time labels · extension to the style root |
| Calendar | noon figure-8 (local mean noon and/or 12:00 zone time) · figure-8 on every hour (reads clock time) · month marks · solstice/equinox lines · zodiac lines · month-start lines |
| Extra marks | Italian hours · Babylonian hours · sun azimuth and altitude lines · substyle · info text · motto |
| Gnomon | triangular polar style and/or perpendicular rod with nodus |
| Output | paper (colour) · painted tile (bold) · laser cut/engrave (hairline) · one sheet or tiled pages |
| Views | front view · 3D view · English / Italiano |

A "measure my wall" helper works out the wall declination from a shadow at a known time, or from a compass bearing.

## Run it

No build step and no dependencies. ES modules need to be served over http:

```sh
python3 -m http.server   # then open http://localhost:8000
```

Settings are stored in the URL hash, so a configured dial can be shared as a link.

## Develop

```sh
npm test                 # node --test, checks the maths against known values
node tools/build.mjs     # copies the site to _site/ and renders sample plans in _site/plans/
```

| File | Purpose |
|---|---|
| `js/astro.js` | sun declination, equation of time, hour angle, sun vector, DST rules |
| `js/dial.js` | wall frame, shadow projection, every dial mark, clipping, auto-fit, warnings |
| `js/svg.js` | front view, print sheets, tiling (pure string generation; runs in Node too) |
| `js/state.js` | defaults, presets, sanity bounds, state → dial |
| `js/view3d.js` | small canvas 3D view |
| `js/i18n.js` | English / Italian strings |
| `js/app.js` | UI wiring |

## CI preview

Every pull request runs `.github/workflows/preview.yml`. It runs the tests, builds `_site/` and uploads it as the **sundial-preview** artifact, which contains the page and the pre-rendered sample plans.

Publishing to `andijcr.github.io` is planned for a later phase. The site is fully static with relative paths, so copying `_site/` (or `index.html`, `css/`, `js/`) into any folder works.
