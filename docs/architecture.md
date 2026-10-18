# How SPSP fits together

SPSP is built from three parts. This repository is the last one, the website.

```
smash_database (public)          ranking build (private)               spsp-web (this repo, public)
tournament data + region rules → computes ratings, writes JSON    →    static site + Cloudflare Worker
  data-Japan / data-North_America   to https://data.spsp.games/<region>/   https://spsp.games/jp/ and /na/
```

1. **[smash_database](https://github.com/tosakazu/smash_database)** collects tournaments, sets and players from start.gg
   (and Challonge for some Japanese brackets). Each region has its own data branch
   (`data-Japan`, `data-North_America`) and its own rules in `scripts/<Region>/`:
   - `classify.py`: labels for each event, such as not 1-on-1 (doubles, team events …), lower-class bracket,
     restricted entry, weekend/holiday and venue location. The build excludes or down-weights events by these labels.
     Japan's version has many more rules (for example invitational / closed and restricted tournaments) than North America's so far.
   - `naming.py`: series recognition (grouping "XYZ #12" with the other "XYZ" events).
   - `geo.py`: geography units (Japanese prefectures, US states / Canadian provinces), written out as `geo.json`.
   - `country.py`: which countries belong to the region, and so which players get the "overseas" tag.
2. **The ranking build** (a separate, private repository) reads a region's data branch, computes the ratings and
   publishes the result as static JSON to `https://data.spsp.games/<region>/` (Cloudflare R2). It only reads data from
   smash_database; it doesn't run the region scripts. Japan is rebuilt several times a day; North America is rebuilt by hand for now.
3. **spsp-web** (this repo) is the website. The same code serves both regions; everything that differs by region is in
   `site/regions/<REGION>/` ([site/regions/README.md](../site/regions/README.md)). Pages fetch the JSON from
   `data.spsp.games` in the browser. The Cloudflare Worker in `worker/` serves the pages and a small API
   ([worker/README.md](../worker/README.md)).

So a wrong tournament label or a missing series is fixed in **smash_database**. A wrong translation, layout or page
behavior is fixed **here**. The rating formulas themselves are in the private build.

## The data the site reads

All paths are relative to the region's data root (`SPSP.data`, e.g. `https://data.spsp.games/na/`).
The build decides these formats. Treat them as read-only inputs and handle missing optional files gracefully.

| File | What it is |
|---|---|
| `meta.json` | build time, evaluation date, counts |
| `data/views/` | small per-page files: ranking chunks (`ranking/<method>/<k>.json`), a player name index, per-character and per-area lists ([site/js/views.js](../site/js/views.js)). Pages use these when `data/views/manifest.json` exists, and fall back to the big files below otherwise |
| `latest_tjpr_full.jsonl`, `players_current.json` | the full ranking (one row per player) and the frequently-changing part of every player. Large for North America, so avoided when views exist |
| `players/<uid>.json`, `history/` | one player's page data, split into a stable part, a volatile part and history ([site/js/player_data.js](../site/js/player_data.js)). Contract: [contracts/player.schema.json](../contracts/player.schema.json) |
| `data/geo.json` | the region's geography units (from smash_database `geo.py`) |
| `data/character_index.json` | characters and their main players |
| `data/overseas.json` | players tagged as from outside the region |
| `data/player_prefectures.json`, `data/player_subranks.json` | each player's area and their rank inside it |
| `data/tournaments.json`, `data/series.json`, `data/upcoming*.json` | tournament list, series, upcoming events |

Files that belong to the site itself (not the build) are in `site/data/`. For example, `char_emoji.json` is the character emoji table.

## Pages, language and region

- Each page is `site/<page>.html` plus `src/pages/<id>.js`. `npm run build` bundles the page script with esbuild
  and writes the HTML in the region's default language ([site/js/README.md](../site/js/README.md)).
- UI text comes from `site/i18n/<lang>.js`. A region can override individual keys in `site/regions/<REGION>/i18n.js`
  (North America says "North America" where Japan says "Japan").
- The default language is per region (NA: English, JP: Japanese). `?lang=ja` / `?lang=en` switches language on the same URL.
- Shared code never hard-codes a region, its areas or its time zone. It reads them from `SPSP.site` (the region's
  `config.js`) and `data/geo.json`.

## Accounts and saved settings

Login uses start.gg OAuth. Player-card settings, titles and character votes are stored in Cloudflare D1 through the Worker's `/api`.
Nothing personal is stored in this repository.

## Deploying

- Merging to `main` deploys spsp.games through GitHub Actions. `main` is protected and needs the owner's approval.
- A preview deployment exists for checking changes before they go live. The owner deploys to it.
- Data updates don't need a site deploy: the build publishes new JSON on its own schedule.

## Older design notes

`docs/archive/` holds the planning notes from the 2026 refactor and the move to Cloudflare. They are in Japanese and
partly out of date; read them only for background. The seeding tool docs (`docs/seed_*.md`) are current but still in Japanese.
