# site/js — shared frontend modules

Shared code used by the pages of the site. Each page's own code lives in `src/pages/<id>.js`.

## How page scripts are built

- `src/pages/<id>.js` starts with `import` lines for the shared modules it needs, followed by the page's own code.
  Default import = the module's API object. A bare `import '…'` only runs the module for its side effects (setting globals, injecting the nav).
- `npm run build` (`tools/build/build_site.mjs`) uses esbuild to bundle each entry into one classic IIFE script, `dist/assets/<id>.js`.
  TypeScript (`.ts`) entries and modules work as-is. `npm run build:na` builds the North America site into `dist-na/`.
- The only `<script src>` tags left in the HTML are `region/config.js` → `i18n/<default lang>.js` → `js/lang_boot.js` (added by the build) → `region/i18n.js` → `assets/<id>.js`.
- Shared modules are ES modules (`export default api` plus named exports). Modules use each other through `import`, not through globals.
  For backward compatibility each one also sets `window.SPSPXxx` and/or `window.SPSP.<Name>` (for the console and external use only).
  New code should import the module instead of reading those globals.
- Tests that run a module's source in `vm` / jsdom use `built()` from `tests/helpers/built.cjs`.
- `tests/meta/script_order.test.cjs` checks that the import order in each page matches the dependencies between modules.

## Shared modules

Paths are relative to `site/`. Modules outside `site/js/` are older shared components that live at the top level.

| Group | Module | Purpose |
|---|---|---|
| Config | `region/config.js` (= `regions/<REGION>/config.js`) | `SPSP.site`: region, languages, time zone, data root, feature flags. Rules are in `site/regions/README.md` |
| Core | `js/html.js` | `escapeHtml`; sets `SPSP.root`, `SPSP.langRoot`, `SPSP.data` (where the JSON lives) and `pageHref` |
| | `js/links.js` | URLs and `<a>` tags for player / tournament / ranking pages (`p/?d=<discriminator>`, falls back to `p/?uid=`) |
| | `js/url_key.js` | ASCII keys for URL query values (`asciiSlug`, `nameKey`) |
| i18n | `i18n/<lang>.js`, `region/i18n.js` | UI string dictionaries per language; the region file overrides some keys |
| | `js/i18n.js` | `t(key, params)`, applies `data-i18n` to the DOM, picks the language |
| | `js/lang_boot.js` | `?lang=` switching (loads the other language's dictionary before the page script runs) |
| | `js/chars.js`, `js/char_emoji.js`, `js/fighter_number.js` | Character names in the display language, character emoji table, official fighter order |
| | `js/geo.js` | Loads `data/geo.json`; turns geo unit ids (prefecture / state) into display names and URL keys |
| Format | `js/format.js` | Level suffixes and labels, rank formatting |
| | `js/tags.js` | Tournament tags (weekend / weekday / restricted / awaiting resume ...); CSS class names come from the caller |
| | `js/match.js` | Short bracket labels, match display order |
| | `js/achievements.js` | Achievement text built from build output `kind` / `params` |
| Data | `js/data.js` | `fetchJson`, `fetchJsonl`, `fetchJsonOptional`, JSONL parsing |
| | `js/views.js` | Small per-page list files in `data/views/`. If `manifest()` returns null, pages fall back to the large files |
| | `js/player_data.js` | Rebuilds a player record from the split JSON (`players/`, `history/`, the volatile current part) |
| Ranking UI | `ranking-table.js` | Ranking table component (columns, sort, filters, infinite scroll) |
| | `player-detail.js` | Expanded row: per-tournament results and head-to-head |
| | `js/ranking_page.js` | Shared skeleton of the four ranking-table pages |
| | `js/list_page.js`, `js/pager.js`, `js/suggest.js` | Sort headers / search on list pages, 5-per-page pager, search suggestion keyboard handling |
| Page chrome | `nav.js`, `logo.js`, `share.js` | Header nav + analytics + notices, logo and loading animation, share / save-as-image |
| Player card | `js/player_card.js`, `js/player_card_model.js` | Renders the player card; builds its data model from player data |
| | `js/titles.js`, `js/titles_ja.js`, `js/title_bits.js`, `js/title_notice.js` | Card titles: lists, draws, owned-title bitsets, "new title" notices. `titles_ja.js` is generated, do not edit by hand |
| | `js/my_notice.js` | Notices for the logged-in player (rank / level up, new titles) |
| Login / posting | `js/login.js`, `js/auth.js`, `js/oauth_state.js` | start.gg login, stored session, OAuth state encode/verify |
| | `js/post_config.js`, `js/post.js`, `js/callback.js`, `js/vote.js` | Posting and character vote pages, OAuth callback |
| Seeding | `seeding/*.js`, `seeding/app/*`, `seed-upload/`, `bracket/` | Seeding tool, seed upload, bracket preview (see `docs/seed_*.md`) |
| Other tools | `js/class_bracket.js`, `sim/calc.js` | Lower-class bracket logic, score simulation |

## Rules

- Put new shared code in `site/js/` as an ES module. If you add a dependency between modules, update `tests/meta/script_order.test.cjs`.
- **UI strings go in the dictionaries**, never inline. Use `t('key', { param })` or `data-i18n` / `data-i18n-attr` in HTML.
  - Keys are namespaced by page (`nav.*`, `ranking.*`, `player.*`, `common.*` ...). Every language file must have the same key set.
  - A sentence is one key, with `{name}` placeholders (plus a minimal `{n, plural, ...}` / `selectordinal`). Do not glue sentence pieces together in code; word order differs between languages.
  - Lookup order: region override (`region/i18n.js`, that language) → language dictionary → default language. A region may only override keys that exist in the language dictionary.
  - Machine-readable text (e.g. CSV column names) is not translated.
  - `tests/meta/i18n.test.cjs` checks that used keys exist, unused keys are removed and key sets match.
- **No hard-coded region names or lists.** Read the region and feature flags from `SPSP.site` (`features` turns features on or off, not the dictionary), and geo units (prefectures, states) from `data/geo.json` through `js/geo.js`.
- Language-specific CSS: `html[lang="en"] .x { … }` in the shared CSS. Region-specific CSS goes in `region/site.css`.
- Page CSS class names are not unified yet, so shared modules take class names as arguments.
- Refactors that should not change the output: compare the DOM before and after with `tests/frontend/compare_with_ref.sh <ref>` (`tests/frontend/README.md`).

## Types

- `npm run typecheck` runs `tsc`. Only files with `// @ts-check` at the top are checked (most of `site/js/`). Global types are in `types/spsp.d.ts`, data contracts in `types/contracts.d.ts`.
- New files may be written in `.ts`; esbuild compiles them during the build.

Background (Japanese, historical): `docs/archive/frontend_stack_review.md`, `docs/archive/frontend_i18n_review.md`.
