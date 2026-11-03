# Wall sundial generator

**Live page: https://andijcr.github.io/sundial_generator/** (pre-rendered sample plans: [`plans/`](https://andijcr.github.io/sundial_generator/plans/))

Design a **vertical declining wall sundial** for any latitude and wall orientation:

- interactive simulation of the shadow, live or at any chosen moment, with day/year animation and a 3D view;
- explanation of the mathematics, with the numbers for your settings;
- a **time-correction chart** that shows what to add to the dial reading through the year, on the page (with a marker for the date being simulated) and as a printable sheet;
- downloadable, dimensioned **SVG plans** in real millimetres: dial face, gnomon template, a mounting/time-correction sheet and the correction chart, optionally split into A4/A3/A2 pages with registration marks.

Defaults: Rome (41.9028° N, 12.4964° E), wall facing south-west (D = 45°).

**Wall direction.** The wall's declination D is measured from the equator-facing direction (south in the northern hemisphere, north in the southern), west positive, so the same number describes the mirrored wall on the other side of the equator: SW 45° in Rome is NW 45° in Sydney. Outside the tropics (|latitude| ≥ 23.44°) only walls facing the sun are offered (−90° to +90°), because a wall facing away gets 2–4 hours of sun a day at best. Within the tropics every direction is offered, since the sun is north of overhead for part of the year (a pole-facing wall at 10° latitude still gets about 5 hours).

Every design choice is a checkbox, so you can compare options on the page:

| Group | Options |
|---|---|
| Hour lines | apparent solar time · zone time with longitude correction · half/quarter hours · Roman numerals · summer-time labels · extension to the style root |
| Calendar | noon figure-8 (local mean noon and/or 12:00 zone time) · figure-8 on every hour (reads clock time) · month marks · solstice/equinox lines · zodiac lines · month-start lines |
| Extra marks | Italian hours · Babylonian hours · sun azimuth and altitude lines · substyle · info text · motto |
| Gnomon | triangular polar style · perpendicular rod with nodus · vertical blade (tip only) |
| Output | paper (colour) · painted tile (bold) · laser cut/engrave (hairline) · one sheet or pages of A4/A3/A2 (portrait, landscape or automatic, with an adjustable printer margin) · colour or black & white |
| Views | front view · 3D view · English / Italiano |

**Gnomon types.** The dial depends only on the nodus, the point at distance L in front of the foot F. The triangular polar style (an edge parallel to the Earth's axis, leaning by the substyle angle) lets the whole edge read the hour. The rod and the vertical blade are tip-only: the same lines, but you read the shadow of the tip. The blade is a flat fin standing in the vertical plane perpendicular to the wall, with its lower edge ending at the nodus and a 45° sloping edge back to the wall, which is the easiest shape to cut and mount. All three can be selected together for comparison.

**Printing on A4 / A3.** Plans print at full scale (1:1, never shrunk), so a big dial is cut into pages with an overlap and alignment marks that coincide on neighbouring pages. The page label sits inside the printable area, so a printer's margin cannot cut it off.
- *Orientation:* automatic picks portrait or landscape for the fewest pages (then the least wasted paper); you can force either, and the page says if the other would need fewer.
- *Margin:* set your printer's unprintable margin (default 8 mm; many printers manage 4–5 mm, which can save a whole row or column of pages). The slack is shared evenly between pages and each tile is centred, so no page is left with a sliver.
- *Saving pages:* when the plan is only a few millimetres over what a row or column of pages holds, the page tells you how much narrower or lower the plate would have to be to save them.
- *Colour or black & white:* black & white is an ink saver: no plate fill, everything black, and the line families (solar, zone time, Italian and Babylonian hours, azimuth, altitude) told apart by dash patterns instead of colour.
- *Print all* sends the dial's pages, the gnomon template, the info sheet and the correction chart to the printer in one job; the last three are sized to take one A4 page each, and each page asks for its own paper orientation.

**Time-correction chart.** A dial that reads solar time needs a correction to show the clock time: the longitude offset from the time-zone meridian plus the equation of time, which swings between about −14 and +16 minutes through the year. The chart plots it against the date, one curve for the solar-time lines and one for the zone-time lines (which already include the longitude). Summer time is not folded into the curves, where a 60-minute step would flatten them; the months it is in force are marked, with "add 60 more minutes". The extremes are labelled with value and date. On the page a marker follows the simulated date and the line above the chart says what to add today. The table on the info sheet and the chart come from the same data, so they always agree.

A "measure my wall" helper works out the wall declination from a shadow at a known time, or from a compass bearing.

## Run it

No build step and no dependencies. ES modules need to be served over http:

```sh
python3 -m http.server   # then open http://localhost:8000
```

Settings are stored in the URL hash, so a configured dial can be shared as a link.

## Develop

Requires Node 22 or newer for the tests and the build script (the page itself needs only a browser).

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

## Publishing

The page is live at https://andijcr.github.io/sundial_generator/. `.github/workflows/pages.yml` runs the tests and deploys `_site/` (the page plus the sample plans) to GitHub Pages on every push to `main`, so a merged PR is online about half a minute later. Set up once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Copying into a separate `andijcr.github.io` repo is not needed: project sites are already served under that domain, and a link from a homepage is enough.

The site is fully static with relative paths, so copying `_site/` (or `index.html`, `css/`, `js/`) into any folder also works.
