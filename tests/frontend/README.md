# tests/frontend

Tests for the front-end JavaScript in `site/js/`, plus a tool that checks a change did not alter what the pages render.

## Unit tests (`npm test`)

`npm test` runs `node --test` over `tests/meta`, `tests/post`, `tests/seeding` and `tests/frontend/*.test.cjs`.
The files in this folder load one module from `site/js/` into a `vm` sandbox with small stubs (no browser, no network) and check its logic:

- `achievements.test.cjs`: achievement and badge text built from the build's `kind`/`params` matches the build's Japanese label, English output has no Japanese left, and old output without `kind` still renders. Fixture: `fixtures/achievement_kinds.json`.
- `char_emoji.test.cjs`, `chars_merge.test.cjs`: character emoji lookup by `main_char_id`, and merging of paired characters (e.g. Samus / Dark Samus) on the player page.
- `class_bracket.test.cjs`: the calculation side of the lower-class bracket tool (start.gg URL parsing, target selection, seed order).
- `my_notice.test.cjs`: personal notices (rank / level up, new titles) appear only when they should and stay dismissed.
- `titles.test.cjs`: the card title list and draw logic. Draws only add to a player's record, so past results never change. Published titles must not be removed or moved (`titles_frozen.json`).

Modules written as ES modules are converted to a classic script with `built()` from `tests/helpers/built.cjs` before being run in `vm`. Other helpers: `tests/helpers/dicts.cjs` loads the language dictionaries (`site/i18n/*.js`), and `tests/helpers/pages.cjs` reads the page entry scripts in `src/pages/`.

## Render comparison (`snapshot_pages.cjs`, `compare_with_ref.sh`)

Use this for changes that should not change what users see (refactors, moving CSS, splitting data files). It is not part of `npm test`.

`snapshot_pages.cjs` opens real pages in jsdom (43 scenarios: ranking and list pages, several players and tournaments, sim, events, priority, news, seed, bracket, vote, post, the explanation pages, ...). It runs scripts in document order, serves the published data in place of `fetch`, and performs actions such as switching tabs, expanding rows, searching and paging. After each step it writes:

- the DOM (`outerHTML` without `<script>`, `<style>` and stylesheet links),
- the CSS in effect (all styles joined in document order),
- the settings passed to Chart.js,
- `errors.txt` with uncaught exceptions, `console.error` output and failed requests.

The clock is fixed (2026-09-13 21:30 JST), `Math.random` and `performance.now` are deterministic, and CDN libraries are stubbed. Running the same version twice gives identical output.

`compare_with_ref.sh <git ref>` renders the given ref (built with `tools/build/build_site.mjs`) and your working tree (`dist/`, so run `npm run build` first) with the same data, then runs `diff -r`. Exit code 0 means no difference, 1 means differences (listed in `compare.diff` in the output directory), 2 means it could not run.

You need:

- jsdom (`npm install`, or a separate install pointed to by `JSDOM_DIR`),
- a local directory with published build output (the JSON files the site reads, such as `players/`, `history/`, `tournaments/`, `data/`, `meta.json`), passed with `--data` (or set the `SPSP_DATA_DIR` environment variable; `tests/meta/contracts.test.cjs` and `tests/seeding/realdata.test.cjs` also read it and are skipped without it). The first files read are copied into `frozen/`, so both sides see the same input even if the data changes mid-run.

```sh
npm run build
tests/frontend/compare_with_ref.sh main --data path/to/published-data
tests/frontend/compare_with_ref.sh HEAD~1 --data path/to/published-data --only '^p_'   # player pages only (regex)
tests/frontend/compare_with_ref.sh main --data path/to/published-data --computed        # compare which CSS rules win per element
```

Other options: `--out <dir>`, `--ignore <selector>` (skip new UI on both sides), `--after-site <dir>`. `snapshot_pages.cjs --live <dir>` serves the live results (`data.spsp.games/live/…`) from a local directory (`<dir>/jp/index.json`, `<dir>/jp/events/<id>.json`). `snapshot_pages.cjs` can also be run directly (`TZ=Asia/Tokyo NODE_PATH=<jsdom node_modules> node tests/frontend/snapshot_pages.cjs --data <dir> --out <dir>`) with `--region NA`, `--lang en`, `--base /jp/` or `--block <regex>`; see the header of the file.

Not covered: layout (widths, wrapping, real colors), images made with html2canvas, and anything that needs start.gg. When moving CSS between files, either keep the joined CSS text identical or use `--computed`.

## Adding a test

Add `tests/frontend/<name>.test.cjs` using `node:test` and `node:assert`. Load the module with `built('js/<file>.js')` into a `vm` context and stub only the globals it uses (`window`, `localStorage`, `SPSPI18n`, `fetch`, ...); see `my_notice.test.cjs` for a short example. Put fixture data in `fixtures/`. `npm test` picks the file up automatically.

## Other test folders

- `tests/meta`: static checks across the site: build output, i18n keys, region configs, script order, data contracts (`contracts/*.schema.json`), URLs and links.
- `tests/post`: the login, post and character vote features (pages, `site/js` modules and the Apps Script code in `gas/`). See its README.
- `tests/seeding`: the seeding tool (optimizer, data, worker, page) and the bracket preview, including jsdom page tests that skip if jsdom is missing. See its README.
- `tests/sim`: `npm run test:sim` checks `site/sim/calc.js` against reference values and against the `data/views/` input.
- `tests/split`: `npm run test:split` checks that split player JSON reassembles to the old format; `smoke_pages.cjs` renders pages against real data.
- `tests/views`: `npm run test:views` checks that pages render the same from the small `data/views/` files as from the full player files (fixture build in `fixtures/build/`).
