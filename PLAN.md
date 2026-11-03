# Sundial Generator — Plan

## Decisions (after first review)
- Every multiple-choice question is an option in the page (checkboxes where options can be
  combined): hour systems, summer-time labels, gnomon type, plate size, paper tiling,
  material, extra marks, language (EN/IT), front and 3D views.
- Preview: a GitHub Action runs on every PR and uploads the static site plus sample SVG plans as an
  artifact. Publishing to andijcr.github.io comes later.

Goal: a static, dependency-free web page that (1) simulates a wall-mounted
(vertical, declining) sundial interactively, (2) explains the maths, and
(3) exports printable, dimensioned SVG plans for the dial face and gnomon.
Defaults: Rome (41.9028° N, 12.4964° E), wall facing south-west.

---

## 1. The mathematics (what the page will explain)

### 1.1 Sun position
Low-precision solar ephemeris (NOAA / Meeus ch. 25, accurate to ~0.01°,
far better than any physical dial):

- From date/time → Julian day → Julian centuries `T`.
- Sun's mean longitude, mean anomaly → **declination δ** (−23.44°…+23.44°)
  and **equation of time E** (−14 min…+16 min).
- **Hour angle** `H = 15° × (apparent solar time − 12h)`, where
  `apparent solar time = clock time − timezone offset + longitude/15° + E`.
- Sun direction in local horizon coordinates (east, north, up):
  `s = (−cos δ sin H, cos φ sin δ − sin φ cos δ cos H, sin φ sin δ + cos φ cos δ cos H)`.

### 1.2 The wall
A vertical wall is described by its **declination D**: the angle of its
outward normal from due south (D = +45° → faces SW, D = −45° → SE).
We build an orthonormal wall frame: `n` (outward normal), `u` (horizontal,
along the wall, pointing right as you face it), `v` (up).

Wall gets sun only when `s · n > 0` — that alone determines the useful
hours (a SW wall in Rome: roughly 10:00 solar time to sunset).

### 1.3 Shadow projection (the core, one formula for everything)
Instead of a zoo of special-case formulas, the code uses one vector
projection. Put a **nodus** (point tip of the gnomon) at distance `L`
in front of the wall at point `P₀`. The shadow of the nodus is where the
ray from the nodus along `−s` hits the wall plane:

```
shadow = P₀ + L·n − (L / (s·n)) · s     → wall coords (x = ·u, y = ·v)
```

Everything on the dial is a set of such points:

| Mark | What is varied |
|---|---|
| Hour line (solar time) | δ over the year at fixed H → a straight line |
| Date line (declination curve) | H over the day at fixed δ → a conic (hyperbola) |
| Equinox line | δ = 0 → a straight line |
| Noon analemma (figure-8) | mean-time noon on every day of the year |
| Italian / Babylonian hours | hours since sunset / since sunrise |

### 1.4 The classic dialling angles (shown as a cross-check)
For a vertical dial at latitude φ with declination D:

- **Style height** (angle of polar gnomon above the wall): `sin SH = cos φ · cos D`
- **Substyle distance** (substyle line from the vertical noon line): `tan SD = sin D / tan φ`
- **Longitude difference** of the substyle: `tan DL = tan D / sin φ`

Rome, SW wall: **SH ≈ 31.8°, SD ≈ 38.2°, DL ≈ 56.3°**. The polar style
(edge pointing at the celestial pole) makes hour lines valid on every day;
its shadow edge crossing the hour lines tells time, and the nodus marks
date curves / analemma.

### 1.5 Time corrections
- Longitude: Rome is 2.5° west of the CET meridian (15° E) → solar time
  runs **~10 min behind** CET.
- Equation of time: up to ±16 min across the year.
- DST: +1 h in summer.
The dial can show apparent solar time (pure, traditional), or bake in
longitude + EoT so it reads clock time (analemma per hour line).

---

## 2. Features

### Simulation page
- Inputs: latitude, longitude, timezone (+DST rule), wall declination,
  gnomon length / dial size; presets (Rome, a few cities); "use my location".
- Time: **live** (real clock, auto-updating) or **chosen** date + time with
  sliders; play/animate a day or a year.
- Front view of the wall (SVG) with the dial, gnomon and live shadow,
  sun-behind-wall / night indication, readout of solar time, clock time,
  EoT, sun altitude/azimuth.
- Optional small 3D-ish view (hand-rolled projection on canvas) of
  wall + gnomon + sun direction, to build intuition.
- "Learn" panel: the formulas above with live numbers for current inputs.

### Dial marks
- Hour lines (with half/quarter hours), labelled.
- Solstice and equinox date curves (+ optionally zodiac/month-start curves).
- Noon analemma (figure-8) with month-start ticks — the "calendar" asked for.
- Optional: analemmas on every hour (clock-time dial), Italian/Babylonian
  hours, substyle line, sun azimuth lines, motto & info text.
- Everything clipped to the plate outline.

### Gnomon types
The dial is fully determined by the nodus N, the point at distance L in front
of the foot F (perpendicular to the wall). The gnomon is only a way to put a
point of shadow-casting material there, so several constructions share one dial:

| Type | Reads | Fixed by | Notes |
|---|---|---|---|
| Triangular polar style | the shadow of the whole edge | latitude and D (`sin SH = cos φ cos D`, plate along the substyle, `tan SD = sin D / tan φ`) | sharpest reading; impossible when the axis is parallel to the wall (D = ±90°) |
| Perpendicular rod | the shadow of the tip | only L | simplest; fuzzy tip |
| Vertical blade | the shadow of the tip | only L (blade height h = L, 45° brace) | flat fin in the vertical plane ⟂ wall; easy to cut and mount; also works for east/west walls |

A *vertical edge* cannot be a polar style (it is parallel to the Earth's axis
only at the poles); its shadow gives azimuth, not time. Open idea: let the user
choose the blade height, and add a pinhole-plate nodus for a sharper spot.

### SVG export (print plans)
- Real units: `width="…mm"` so 1 user unit = 1 mm at 100 % print scale.
- **Sheet 1 — dial face** with gnomon foot / nodus foot marked, plate
  dimensions, a 100 mm scale bar to verify print scaling, the vertical
  (plumb) reference line for mounting.
- **Sheet 2 — gnomon**: triangular polar-style template with style height
  angle, lengths, nodus position, mounting tabs (or a rod: length + angle,
  or a vertical blade: lower edge L, height h, tip angle, fold tab).
- **Sheet 3 — mounting/info**: wall declination, latitude, how to align,
  corrections table (EoT by date + longitude correction) for converting
  dial time to clock time.
- Optional tiling into A4/A3 pages with registration marks for large dials.

### Sanity bounds & warnings
- Latitude clamped to ±(66.5°−ε); warn near the equator (gnomon nearly
  parallel to wall when facing south).
- |D| close to 90° (east/west walls): hour lines nearly parallel, substyle
  runs off the plate → warn; still computed correctly by the vector method.
- |D| > 90° (north-ish walls): sun only early/late in summer → warn,
  show "hours of sun on this wall per year".
- Grazing sun (`s·n` → 0): shadow runs to infinity → cut points beyond
  the plate, never emit giant coordinates.
- Southern hemisphere handled (pole is south, labels flip).
- Gnomon length vs plate size: suggest a nodus length so solstice curves
  fit on the plate.

### Measuring your wall (helper)
Wall declination is the input most people get wrong. Helper tool: hold a
plumb line / ruler against the wall, note the time when the shadow is
perpendicular to the wall (or measure an angle at a known time) → page
computes D from the sun's azimuth. Plus a compass method with magnetic
declination note (~+4° E in Rome).

---

## 3. Architecture (no build step)

```
index.html        page shell, controls, explanatory text (EN/IT)
css/style.css
js/astro.js       sun position, EoT, declination, DST rules, time helpers (pure)
js/dial.js        wall frame, projection, every mark, clipping, auto-fit, warnings
js/svg.js         SVG builders: front view, print sheets, tiling (pure strings)
js/state.js       defaults, presets, sanity bounds, state -> dial
js/view3d.js      small canvas 3D view
js/i18n.js        English / Italian strings
js/app.js         UI wiring, URL hash for shareable settings
tools/build.mjs   builds _site/ and pre-renders sample plans
test/*.test.js    `node --test` checks against known values (no deps)
.github/workflows preview.yml (PR artifact) and pages.yml (deploy main)
CLAUDE.md         notes for working on the code with Claude
```

Native ES modules (`<script type="module">`), works directly on GitHub
Pages. No npm install required to run; `node --test` for the maths tests.

## 4. Milestones
1. `astro.js` + tests (declination, EoT, sun alt/az vs NOAA values).
2. `dial.js`: projection, hour lines, date curves, analemma, clipping + tests
   (compare SH/SD/DL against closed-form formulas).
3. Interactive front view + time controls (live / chosen / animate).
4. SVG print export (face, gnomon, info) with dimensions & scale bar.
5. Explanations panel, wall-measuring helper, warnings.
6. Polish, URL-shareable settings, GitHub Pages publishing.
7. Third gnomon option: vertical blade (tip-only) with its own template.

Milestones 1-7 are done. Known gaps and ideas: during animation the trail and
3D view are redrawn in full every frame; with every option on, some labels at
the foot of the figure-8s overlap; adjustable blade height; pinhole nodus.
