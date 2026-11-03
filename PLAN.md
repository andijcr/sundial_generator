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

The page asks for the wall differently: as the declination **Δ from the
equator-facing direction** (south in the northern hemisphere, north in the
southern), west positive. In the north Δ = D; in the south D = 180° − Δ, so
the same number means the mirrored wall on the other side of the equator (a
SW 45° wall in Rome ↔ a NW 45° wall in Sydney). `absoluteDeclination` in
`dial.js` converts at the boundary; the maths only ever sees D from south.

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
- Tiling into A4/A3/A2 pages, always 1:1 (a dimensioned plan must not be scaled):
  `tileLayout` plans it. It tries portrait and landscape and keeps the one with the
  fewest pages (then the least wasted paper; for a sheet that fits on one page, the
  orientation matching its shape); the user can force either. The printer's
  unprintable margin is a setting (default 8 mm). Each page has a 7 mm header strip
  inside the printable area for its label (page n/N, row · column, paper, overlap,
  margin); the leftover space is shared evenly so tiles are equal, centred, and no
  page is a sliver; a sheet that fits is one page with no overlap. Alignment marks sit
  at the centres of the overlap zones so they coincide on neighbouring pages.
  `tileSavings` tells the user the smallest trim (≤ 12 % of a side) that removes a
  whole row or column of pages. The sheets are sized to their content: the face sheet's
  margins follow its dimension labels (`faceMargins`), the info sheet is 190 mm wide and
  the gnomon template is no wider than its drawing, so the info sheet and the template
  each take one A4 page.
- Ink: colour, or black & white as an ink saver (no plate fill, black only, line
  families told apart by dash pattern and weight: `BW_STYLE`).
- "Print all" prints the dial's pages, the gnomon template and the info sheet in one
  job, with CSS named pages so each can have its own paper orientation.

### Sanity bounds & warnings
- Latitude clamped to ±(66.5°−ε); warn near the equator (gnomon nearly
  parallel to wall when facing south).
- |D| close to 90° (east/west walls): hour lines nearly parallel, substyle
  runs off the plate → warn; still computed correctly by the vector method.
- Walls facing away from the sun (|Δ| > 90° from the equator-facing direction)
  are not offered outside the tropics (|lat| ≥ 23.44°), where they get 2–4 h
  of sun a day on average (Rome: 9.9 h for the south wall, 2.2 h for the north
  one). Inside the tropics every direction is offered, since the sun is north
  of overhead for part of the year (at 10° latitude the pole-facing wall still
  gets about 5 h). `sanitize` clamps to ±90° with a warning, the slider range
  and the presets follow the latitude, and "hours of sun on this wall per
  year" is still shown.
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

## 5. Later: gnomon width (thickness) and the build

Not implemented; notes for a future change. "Width" here is the thickness of whatever casts the
shadow: the plate of the polar style, the blade, the rod (diameter) or a bead.

### 5.1 What the maths assumes
Every line on the dial assumes an ideal gnomon (a zero-thickness style edge, a point nodus) and a
point sun. A real one has thickness t, and the sun is a disc 0.533° wide. Both blur the shadow's
edge, and a thick plate can also be read on the wrong edge.

### 5.2 How much it matters (default dial: Rome, SW wall, L = 73 mm, SH 31.75°)
Computed with the dial code (move the script into `dial.js` as a tested function when this is built).

**Sideways error of the shadow edge**, e = 1.5 mm (a 3 mm plate read on one edge instead of its
centre). Time error in minutes, at a distance r from the style root along the hour line:

| hour line | r = 50 mm | 100 mm | 200 mm | 400 mm |
|---|---|---|---|---|
| 11:00 | 4.7 | 2.3 | 1.2 | 0.6 |
| 13:00 | 9.1 | 4.5 | 2.3 | 1.1 |
| 15:00 | 12.0 | 6.4 | 3.2 | 1.6 |
| 17:00 | 11.9 | 6.0 | 3.0 | 1.5 |

The error scales as 1/r (and linearly with e): read the time **far from the root**, where the hour
lines fan out. Near the root a fraction of a millimetre is minutes.

**The sun's disc.** 0.533° is 2.1 min of hour angle, so no dial reads better than about ±1 min
without a pinhole. The penumbra on the wall is the ray length (L / s·n) × 0.0093: 0.7 mm with the
sun square on, 1.4 mm 30° off the wall plane, 2.6 mm at 15°. As a time error (half the blur) on the
15:00 line at s·n = 0.5: ±2.9 min at r = 100 mm, ±1.4 min at 200 mm, ±0.7 min at 400 mm.

So a thickness under about 0.5 mm disappears into the penumbra, and above about 1.5 mm it dominates.

### 5.3 Where the width enters the build
1. **Polar style (plate).** The shadow of a plate t thick is a band t wide, centred on the ideal
   hour line. Reading its centre is exact; reading an edge is off by t/2 (table above). The lit
   face flips when the sun crosses the plate's plane (the substyle hour, 15:45 here), so no single
   offset of the printed lines can compensate on both sides of it. Remedies: a knife edge (bevel
   the sun-facing style edge on both faces, about 2 t deep for a 30° included angle), or t ≤ 1 mm.
   Read the shadow of the *sloping* style edge (the line R–S), not of the plate's base.
   The plate's **mid-plane**, not its face or its fold line, must lie on the substyle line R–F. A
   tab folded to one side puts the mid-plane t/2 (plus the bend radius) from the fold, which the
   template should state.
2. **Rod and blade (tip only).** Thickness smears the tip's shadow into a segment t long (for the
   blade along the wall's horizontal, which is the hour direction). A flat-cut rod end is read at
   its edge, up to d/2 off its axis. Remedies: taper the blade to a point; use a bead whose
   *centre* is at distance L (so the rod to the bead centre is L, not L + d/2); or a pinhole plate,
   where the centre of the sun's image is the ideal point and the spot is about
   hole + 0.0093 × ray length across.
3. **Where L is measured from** is the dial's surface (tile, render), not the wall behind it:
   the thickness of the dial panel moves the nodus.
4. **Stiffness.** The free sloping edge of a thin plate flexes and moves the line by more than its
   thickness does. As a rule of thumb (judgement, not computed) use ≥ 2 mm or a brace for a style
   longer than about 200 mm. The template could show the brace.
5. **Process.** Laser kerf (about 0.1–0.3 mm) makes parts slightly small, and bending adds an
   allowance. Dial lines should not be wider than the shadow band, so its centre stays readable
   (the bold "tile" style goes with thick plates).

### 5.4 Proposed changes
- A thickness setting `gT` (mm; 0 = ideal, today's behaviour), bounded. Warn when the half-thickness
  error at the nearest sensible reading distance would exceed about 2 min.
- Simulation: draw the shadow band with its real width plus the penumbra, and show "reading
  uncertainty ± x min" for the current shadow position. It teaches the "read far from the root" rule.
- Templates: thickness dimension, bevel annotation and depth, the fold tab's mid-plane offset, a
  tapered blade tip, and bead and pinhole variants with the right lengths.
- Info sheet: a tolerance list for this dial (nodus within ± x mm of L, style angle within ± y°),
  with x and y computed from the model.
- New tip types for the tip-only gnomons: pointed blade, bead, pinhole plate.
- Tests: the offset-to-minutes figure from the model; thickness 0 reproduces today's output exactly.
- Open questions: which sheet thicknesses and materials will actually be used; whether to model
  the penumbra as a ± or as a band; whether the bead and pinhole options are wanted at all.
