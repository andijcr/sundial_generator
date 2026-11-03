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
- One formula drives every mark: `shadowPoint` in `dial.js` projects the nodus (L in front of the foot F) along the sun direction onto the wall. Do not add special-case formulas; `dialAngles` exists only to cross-check in tests.
- Vectors are `[east, north, up]`. Wall declination D: 0 faces south, positive turns west (45 = SW, 180 = north). Hour angle H is 0 at apparent noon and positive in the afternoon. EoT is apparent minus mean time.
- Dial coordinates are millimetres, origin at F, x to the right when facing the wall, y up. SVG y points down, so draw at `P.fy - y`.
- Print sheets use real units (1 user unit = 1 mm); keep `width`/`height` in `mm`.
- Settings live in `DEFAULTS` (`state.js`), and the URL hash stores only values that differ from it. `sanitize` clamps numbers and validates enums. Never put a URL-derived string into HTML or `document.write` without escaping or validating it (`place` is checked against `PRESETS` for this reason).
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
- Element ids must be unique across the control panel and the SVG: a checkbox once collided with the SVG trail group. Scope lookups, e.g. `#front #trail`.
- `assert.deepEqual` treats `-0` and `0` as different.
- Do not use `pkill -f <pattern>` in the shell tool: it can match its own shell. Kill by port or pid.
- Auto-fit ignores sun within `grazing` degrees of the wall plane, so late-morning/low sun shadows can fall off the plate by design.

## Workflow
- Default branch `main`. Work on a feature branch and open a PR; never push to `main` directly.
- `.github/workflows/preview.yml` runs the tests and uploads the site plus sample plans as an artifact on every PR.
- `.github/workflows/pages.yml` deploys `_site/` to GitHub Pages on every push to `main` (Settings → Pages → Source: GitHub Actions).
