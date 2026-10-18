# site/regions/ — per-region settings and wording

A **region** is one ranking (Japan = `JP`, North America = `NA`) and one deployment: `https://spsp.games/jp/` and
`https://spsp.games/na/`, with data JSON served from `https://data.spsp.games/<region>/`. Everything that differs between
regions lives in `site/regions/<REGION>/`; the rest of `site/` is shared code used by every region.

There are no silent defaults: every region directory has the same files, and `tests/meta/regions.test.cjs` fails if one is
missing or out of shape. `JP` is the reference.

```
site/
  region -> regions/JP      symlink to the region served locally; pages load region/config.js, region/i18n.js, region/site.css
  regions/
    JP/  config.js  i18n.js  site.css
    NA/  config.js  i18n.js  site.css
```

## Files every region must have

### `config.js` — site settings (`window.SPSP.site`)
Every region must have exactly the same keys (and value types) as `JP`; only the values differ. Important keys:

| Key | Meaning |
| --- | --- |
| `region` | Region code; must equal the directory name. |
| `langs`, `defaultLang` | UI languages offered (`site/i18n/<lang>.js`) and the default one (must be in `langs`). |
| `timeZone`, `utcOffset` | Time zone used for display. |
| `dataRoot` | Where the data JSON lives (`''` = same origin). The build overwrites it with `--data-root`. |
| `canonical` | `{ origin, base }` of the public URL. The build overwrites it with `--canonical`. |
| `cleanUrls` | Links without `.html`. Must be `false` in the source; `--clean-urls` turns it on. |
| `regions` | URL of each regional site, used for the region switcher in the nav (`''` = no link). |
| `analytics.gaId` | Google Analytics ID (`''` = none). |
| `auth`, `vote`, `support` | start.gg login app per origin, vote test accounts, and the contact shown to users (`''` = hidden). |
| `features` | Turns whole features on or off (`blog`, `vote`, `seeding`, `prefRanking`, `sim`, `titles`). |
| `geo.unitKey` | Geographic unit: `prefecture` (JP) or `state` (NA). |
| `titleLang`, `titleDefault` | Player-card title list language and the fallback title. |
| `calendar.weekendRealLabel` | Show Japan's "effective holiday / weekday" concept. |

Turn features on and off with `features`, not with wording. If a region needs new behavior, add a key to **every**
region's `config.js` and branch on `SPSP.site` in shared code. Never hard-code region values (`'JP'`, prefecture names,
`+09:00`, ...) in shared code.

### `i18n.js` — region-specific wording
Sets `window.SPSP_I18N_REGION.<REGION> = { <lang>: { key: text } }`. Rules (checked by the test):

- Only one entry, named after the directory, with one object for each language in `config.langs`.
- Override only keys that already exist in `site/i18n/<lang>.js`. Shared wording that is the same for every region goes in the language dictionary, not here.
- The language dictionaries use Japan's wording. For any region other than JP, **every** key whose text says
  `全国` / `日本` (ja) or `Japan` / `nationwide` / `national` (en) must be overridden, and the new text must not
  still contain those words. This is why `NA/i18n.js` has keys such as `common.national` → `North America`.

Lookup order: the region override, then the language dictionary, then the default language. This happens at build time
(`tools/build/build_site.mjs`) and again in the browser (`site/js/i18n.js`).

### `site.css` — region-only CSS
Loaded as the last stylesheet on each page. Put region-specific layout here (for example, column widths on a region page).
CSS that depends on the *language* (English text is longer, font stacks) goes in shared CSS as `html[lang="en"] .x { ... }`.
Both regions' files are currently empty.

## How the build picks a region

`node tools/build/build_site.mjs --region NA` (`npm run build:na`) reads `regions/NA/config.js` and `regions/NA/i18n.js`,
fills the HTML with the default-language text, and copies the files from `regions/NA/` into `out/region/` as real files
(replacing the symlink and applying `--data-root` / `--canonical` / `--clean-urls`). `npm run build:cf` builds both
`dist-cf/jp` and `dist-cf/na`. Each region publishes one HTML set in its default language; the other language is the
same URL with `?lang=en` / `?lang=ja` (`site/js/lang_boot.js`).

To try another region locally, run `ln -sfn regions/NA site/region` (do not commit this) or
`tests/frontend/snapshot_pages.cjs --region NA`. On Windows, set `git config core.symlinks true` before checking out,
or the symlink becomes a plain text file.

## Changing North America wording

1. Find the key in `site/i18n/en.js` (or `ja.js`), for example by searching for the text shown on the page.
2. If the wording is NA-specific, add or edit the key under `en:` (and `ja:`) in `site/regions/NA/i18n.js`.
   If the English is just wrong for every region, fix `site/i18n/en.js` instead.
3. Run `npm test`. It fails on unknown keys, missing languages, or Japan wording left in NA.
4. Open a PR. All changes need review from the code owner.

## Geography

Prefecture and state names, codes, and groupings are **not** in the frontend code. They come from `data/geo.json`, which is
generated by smash_database `scripts/<Region>/geo.py` and published with the region's data. `site/js/geo.js` loads it
from the data root and converts unit ids to display names. To fix a state name or grouping, change `geo.py` in
smash_database, not this repo. NA state detection is still provisional.

Background (historical design notes, in Japanese): `docs/archive/frontend_i18n_review.md`.
