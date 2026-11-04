# CLAUDE.md

Wall sundial generator: a static, dependency-free page that simulates a vertical declining sundial and exports dimensioned SVG plans. Defaults: Rome, wall facing south-west (D = 45°). See `README.md` for features and `PLAN.md` for the maths and design decisions.

## Commands
- `npm test` — `node --test test/*.test.js` (Node 22+). Run it before every push.
- `python3 -m http.server` then open http://localhost:8000. ES modules do not load over `file://`.
- `node tools/build.mjs [outDir]` — copies the site to `_site/` and renders sample plans to `_site/plans/`. `_site/` is gitignored.
- No npm dependencies, no bundler. Keep it that way.

## Layout
`js/astro.js` sun/EoT/DST (pure) · `js/dial.js` wall frame, projection, every mark, auto-fit, warnings · `js/svg.js` front view, print sheets, tiling (pure strings, runs in Node) · `js/state.js` defaults, bounds, `sanitize`, `buildDial` · `js/view3d.js` canvas 3D · `js/i18n.js` EN/IT · `js/app.js` UI wiring · `tools/build.mjs` · `test/`.

## Conventions
- The correction from dial reading to clock time (equation of time, longitude, summer time) is computed once, in `yearCorrections` (`astro.js`); the info sheet's table and the correction chart (`correctionGraph` in `svg.js`, also drawn on the page) both read it. Change the formulas there, not in a drawing function. The chart plots standard time and *marks* summer time (it is not added to the curves).
- One formula drives every mark: `shadowPoint` in `dial.js` projects the nodus (L in front of the foot F) along the sun direction onto the dial plane, in the plane's axes (x = ·u, y = ·v). Do not add special-case formulas; `dialAngles` exists only to cross-check in tests.
- `plane` is `'wall'` or `'horizontal'` (`PLANES`). Get the frame from `dialFrame(D, plane)`, never `wallFrame` directly in dial code; a horizontal plate is n up, u east, v north (top edge to true north) and ignores D. Sheet wording for the plate comes from `planeT` (`svg.js`): it uses `key + 'H'` when that string exists, so never name a key after another key plus `H` (`planeHorizontal`, not `planeH`).
- The wall's `D` in state, the UI and the URL is measured from the *equator-facing* direction (south in the north, north in the south), west positive. `dial.js` wants D from due south. Convert with `absoluteDeclination(lat, D)` at the boundary (`buildDial`, the 3D view yaw, the "faces" text) and never pass state `D` straight to `computeDial`/`autoFit`. Outside |lat| < 23.44° (`TROPIC_LAT`) only |D| ≤ 90° is allowed (`wallLimit`, enforced by `sanitize`).
- Vectors are `[east, north, up]`. Wall declination D from south (what `wallFrame` and `dial.js` use): 0 faces south, positive turns west (45 = SW, 180 = north). Hour angle H is 0 at apparent noon and positive in the afternoon. EoT is apparent minus mean time.
- Dial coordinates are millimetres, origin at F, x to the right when facing the wall, y up. SVG y points down, so draw at `P.fy - y`.
- Print sheets use real units (1 user unit = 1 mm); keep `width`/`height` in `mm`. Never scale a plan to fit a page: `tileLayout` (`svg.js`) is the single place that plans pages (orientation, the printer margin, balanced tiles, the 7 mm header strip for the page label). Sheet sizes follow their content (`faceMargins`, the 190 mm info sheet, the gnomon sheet's estimated `right` edge), and label widths are *estimated*, so after changing what a sheet draws, render it and measure the free space around the ink (Playwright screenshot, find the non-white bounding box) in both languages and with small and large plates.
- Ink: `ink: 'bw'` goes through `dialCss(material, sw, bw)` and `sheetCss(bw)`. Every new line family needs an entry in `BW_STYLE` (a distinct dash pattern: black only, no colour), and sheet markup must take its colours from CSS classes, not attributes (the black-and-white test fails on any colour).
- Settings live in `DEFAULTS` (`state.js`), and the URL hash stores only values that differ from it. `sanitize` clamps numbers and validates enums. Never put a URL-derived string into HTML or `document.write` without escaping or validating it (`place` is checked against `PRESETS` for this reason).
- `rodX` (1 to `ROD_MAX` = 10, in tenths) is a modifier of the rod and of the triangular style (the whole triangle scaled about the root R, notch on the hypotenuse at N), not a fourth gnomon: the rod's shadow line is scaled by it (front view, 3D, `shadowMarkup`), the nodus dot stays at the true shadow point, and the gnomon sheet draws the long rod horizontally with a notch L from the wall. `fitPlateToPage` and `fitGnomonScale` (`state.js`) are the "one page" searches (plate size, as big as possible with the brief caption `faceBrief`; then, with `fitGnomonX`, the largest `rodX` whose gnomon sheet is one page, which never changes the dial); they need `tileLayout`, `buildDial` and `gnomonSheet` to stay cheap.
- Keep the gnomon types in sync: at least one of `gPolar`, `gRod`, `gBlade` is always on (`sanitize` restores the rod). Warnings about the style root only apply when `gPolar` is on.

## Adding an option
1. Default in `DEFAULTS` (`state.js`), plus a bound in `BOUNDS` if numeric.
2. Control in `index.html` with `data-k="<key>"` and a `data-i18n` label.
3. Strings in **both** languages in `i18n.js`.
4. Logic in `dial.js` / `svg.js` (and `view3d.js` if it shows in 3D).
5. Tests in `test/dial.test.js`; add the option to the "sheets render without NaN" matrix.
6. Mention it in `README.md` and `PLAN.md`.

## Checking visual changes
Unit tests do not catch overlapping or misplaced labels. Render the sheets and the page with the pre-installed Playwright/Chromium and look at the screenshots, in both languages and with small and large plates.

## Gotchas
- Element ids must be unique across the control panel and the SVG: a checkbox once collided with the SVG trail group. Scope lookups, e.g. `#front #trail`. The same goes for the pages of one print job: clip-path ids include the sheet name, because several sheets share one document.
- `assert.deepEqual` treats `-0` and `0` as different.
- Do not use `pkill -f <pattern>` in the shell tool: it can match its own shell. Kill by port or pid.
- Options that only matter alongside others must not be silent no-ops: disable the control in `writeControls` (`app.js`) and say why in its label (`hExtend` needs `gPolar`; `hDstLabels` needs zone-time lines or figure-8s, see `dstLabelsApply` in `state.js`).
- `autoFit` clamps L to `L_MIN`..`L_MAX` and relaxes `grazing` when nothing is lit; `buildDial` turns both into warnings. Do not let a new code path pass an unbounded L on.
- Auto-fit ignores sun within `grazing` degrees of the wall plane, so late-morning/low sun shadows can fall off the plate by design.
- To undo an experiment (a mutation check, say), copy the file aside and copy it back. `git checkout <file>` also throws away your uncommitted edits to it, which once cost a rewrite.
- `git fetch` can stall behind the proxy: run it as `timeout 90 git fetch origin <branch>`, kill a hung one by pid, and retry.

## Workflow
- Default branch `main`. Work on a feature branch (`claude/<topic>`; creating and pushing these works) and open a PR; never push to `main` directly. Check that the repo has pull requests switched on if creating one fails.
- The live site is https://andijcr.github.io/sundial_generator/ (plans in `/plans/`). `.github/workflows/pages.yml` runs the tests and deploys `_site/` on every push to `main`, so a merge is online within a minute; check the run before saying it is live.
- `.github/workflows/preview.yml` runs the tests and uploads the site plus sample plans as an artifact on every PR.
- PRs are **squash-merged**, so `main` stays linear. Wait for the `build` check on the current head before merging.
- **Stacked PRs** (each depends on the previous): base a PR on the previous branch, merge them in order, and after each squash merge retarget the next PR to `main` (`base`). A squash leaves copies of the lower commits on `main` that clash with the originals still in the stacked branch, so the next PR can report a conflict. When `git diff origin/main <previous branch tip>` is empty (nothing on `main` that the branch lacks), `git merge -s ours origin/main` on the branch and a normal push fixes it, and the diff shows only the PR's own change again. Unpushed branches above a merged one are replayed with `git rebase --onto origin/main <old base tip> <branch>`, with the tests rerun on each.
- A PR description ends with the attribution lines the session gives; each commit ends with its `Co-Authored-By` and `Claude-Session` trailers.
