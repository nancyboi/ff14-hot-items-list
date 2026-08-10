# FF14 Hot Items List

Finds FFXIV market board items on a given world that are moving in high
volume *right now* - price is not a factor, only sale velocity - then lets
you filter down to what you can actually supply: by source (gathered /
crafted / vendor-bought), by specific job (Leatherworker, Botanist, etc.),
and by your current level in each of those jobs.

## How it works

1. **Universalis** (`src/universalis/`) — pulls the item IDs with the freshest
   market activity on a world (`/extra/stats/most-recently-updated`), then
   fetches current listings, sale history, average price, and sale velocity
   for those items in batches.
2. **Scoring** (`src/scoring/hotScore.ts`) — items are ranked purely by
   `regularSaleVelocity` (sales/day). Price and profit margin are not part of
   the ranking at all - "hot" means moving a lot, full stop.
3. **Sourcing / effort** (`src/sourcing/`) — a separate, static dataset built
   from the community [FFXIV datamining CSVs](https://github.com/xivapi/ffxiv-datamining)
   (Universalis has no recipe/gathering data of its own). Every item gets:
   - `gatherJobs` — which gathering job(s), if any, can pull it directly:
     `Miner` (mining/quarrying nodes), `Botanist` (logging/harvesting nodes),
     `Fisher` (fishing spots and spearfishing).
   - `vendor` / `craftable` — bought from an NPC and/or produced by a recipe.
   - `effortTier`:
     - `0` — gatherable directly and/or vendor-bought
     - `1` — craftable from only gatherable/vendor ingredients (one step)
     - `2+` — craftable, but at least one ingredient is itself a craft (the
       number is the nesting depth)
     - `null` — not gatherable, not vendor-bought, not any known recipe's
       result — likely a drop or quest reward this dataset can't identify
       precisely (there's no public monster-loot-table CSV to join against).

   Recipes and gathering nodes also record the job level required
   (`RecipeLevelTable.ClassJobLevel`, `GatheringItemLevelConvertTable.GatheringItemLevel`),
   which feeds into acquirability below. `effortTier` is still computed and stored in the
   sourcing dataset, but is no longer surfaced in the dashboard/API output - tags plus the
   level filter convey the same "how do I get this" info more directly.

### Tags (`src/tags.ts`)

Every item gets a set of tags, shared by the CLI's `--include-tags`/`--exclude-tags` and the
dashboard's clickable tag chips:

- **Source tags** — `gathered`, `crafted`, `vendor`.
- **Job tags** — one per job in `src/jobs.ts` that can gather or craft the item (e.g.
  `Leatherworker`, `Botanist`), id'd by the job's full name.
- **`elemental`** — the 18 base Fire/Ice/Wind/Earth/Lightning/Water Shard/Crystal/Cluster
  items (IDs 2-19). These trade in huge, constant bot-driven volume and would otherwise
  dominate a pure-sale-velocity ranking; this is a curated ID list rather than a name match,
  since plenty of unrelated items ("Crystal Chandelier", the job soul shards, etc.) also have
  "crystal"/"shard"/"cluster" in their name.

Including tag(s) keeps items matching *any* of them (OR); excluding drops items matching *any*
excluded tag.

### Level-aware acquirability

Given a set of job levels (from the UI form or `PLAYER_LEVELS`), `src/sourcing/acquirability.ts`
checks, per item, whether you can actually get it - recursively, since a craft's ingredients may
themselves need to be gathered/crafted:

- **acquirable** — vendor-bought, or gatherable at a node level you meet, or
  craftable by a job you have at a high enough level (ingredients may need to
  be bought off the market board).
- **selfSufficient** — acquirable *and* every ingredient is, recursively,
  also something you can gather/vendor-buy/craft yourself - no market board
  trip needed.

When "only show items I can acquire" is combined with a specific job tag (e.g. filtering to
`Leatherworker`), the level check is enforced for *that job specifically*
(`canObtainViaJob`), not "acquirable by any means" - otherwise a level-5 Leatherworker
search could show a level-70 recipe just because the same item also happens to be sold by a
vendor or craftable by some other job.

This also changes *how* candidates are sourced: normally the pipeline pulls the ~200
most-recently-updated items from Universalis and filters those (see the caveat about that
200-item cap below). But rarely-traded low-level items can be genuinely for sale and never
appear in that recency window at any candidate count. So when a job tag + "only show items I
can acquire" are both active, the pipeline instead scans the whole sourcing dataset for every
item that job can obtain at your level *first*, then fetches market data only for that set -
slower for a high-level job with hundreds of eligible recipes, but it actually finds
low-traffic items instead of silently missing them.
4. **AI blurbs** (optional, `src/ai/blurbs.ts`) — the ranking above is
   deterministic. If you pass `--ai-blurbs` (and set `ANTHROPIC_API_KEY`),
   Claude writes one short plain-English sentence per item summarizing why
   it's hot and how easy it is to get, from its tags - a summarization step
   on top of numbers we've already computed, not the thing doing the ranking.
5. **Dashboard** (`public/`) — a static page that reads `data/hot-items.json`
   and renders a table with sales/day, average price, and a tags column per
   item.

## Setup

```bash
npm install
npm run build:sourcing   # builds data/item-sourcing.json from datamining CSVs (run once, re-run after game patches)
```

## Usage

```bash
npm run serve
# open http://localhost:4173
```

The dashboard is interactive: pick a world, a time window (past day/week/month),
your current level in each DoL/DoH job, and any tag chips, then click **Search**.
This hits `POST /api/search` on the dev server (`src/server.ts`), which re-runs
the same Universalis fetch + scoring + sourcing pipeline as the CLI on demand -
no page reload, no separate command. Job level fields come from `GET /api/jobs`
and tag chips from `GET /api/tags`, so both stay in sync with `src/jobs.ts` /
`src/tags.ts` automatically.

- **Tag chips** — click a chip once to require it (include, OR'd with any
  other included chips), click again to exclude it, click a third time to
  clear it. Source tags (Gathered/Crafted/Vendor), every job, and the
  `elemental` tag (crystals/shards/clusters) are all filterable this way -
  e.g. click "Leatherworker" to only see items a Leatherworker can get, or
  click "Elemental" twice to hide the bot-flooded base crafting currencies.
- "Only show items I can acquire" (on by default) drops anything you can't
  gather at your level, isn't sold by a vendor, and can't be crafted by a job
  you have at a high enough level (see [Level-aware acquirability](#level-aware-acquirability)).
  Combined with a job tag, this enforces the level requirement for that job
  specifically rather than "acquirable by any means."
- Time period controls the sale-velocity window: past day / week / month.
  Universalis' own `regularSaleVelocity` field uses a fixed, undocumented
  window, so this project fetches raw sale history
  (`GET /api/v2/history/{world}/{items}`) and computes its own sales/day over
  whatever window you pick (`computeVelocityForWindow` in
  `src/scoring/hotScore.ts`). Universalis' history retention is itself
  limited, so a "past month" query may still only have a few days of actual
  sales to work with for low-volume items.

You can still run the pipeline from the command line without the server:

```bash
npm run generate -- --world=Siren
```

Options for `generate`:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--world` | `Siren` | Universalis world name to scan |
| `--limit` | `25` | Max items in the final list |
| `--candidates` | `200` | How many recently-updated items to pull stats for before scoring |
| `--days` | `7` | Sale-velocity window in days (e.g. `1`, `7`, `30`) |
| `--ai-blurbs` | off | Have Claude write a one-line note per item (requires `ANTHROPIC_API_KEY`, see `.env.example`) |
| `--include-tags` | off | Comma-separated tag ids (see `src/tags.ts`); only include items with at least one, e.g. `--include-tags=Leatherworker,Botanist` |
| `--exclude-tags` | off | Comma-separated tag ids; drop items with any of these, e.g. `--exclude-tags=vendor` |
| `--all-levels` | off | Skip the acquirability filter and include items regardless of `PLAYER_LEVELS` |

The CLI reads job levels from the `PLAYER_LEVELS` env var (see
`.env.example`); the web UI's form overrides this per-request instead.

## Notes from a live run

This was originally scaffolded in a sandboxed environment with
`universalis.app` blocked, so `src/universalis/client.ts` was untested
against the real API. Since verified live against Siren:

- The `fields` filter on `GET /api/v2/{world}/{itemIds}` needs an `items.`
  prefix on each field name for multi-item requests (the response is
  namespaced under `items`), but no prefix for single-item requests. Without
  it, the API silently returns `{}` - this was the cause of an earlier "no
  hot items found" bug and is now handled in `client.ts`.
- `/extra/stats/most-recently-updated` caps out at 200 entries regardless of
  the `entries` param requested - raising `--candidates` above 200 has no
  effect. This is also why job-tag-filtered acquirable searches source
  candidates differently; see [Level-aware acquirability](#level-aware-acquirability).
- Transient errors (429/502/503/504) are retried with backoff in
  `getJson` (`client.ts`) - occasional Universalis 504s no longer fail the
  whole search.
- Watch for rate-limit responses; `MAX_IDS_PER_REQUEST` /
  `DELAY_BETWEEN_BATCHES_MS` in `client.ts` are conservative placeholders.

The sourcing dataset (`npm run build:sourcing`) has been run for real and
spot-checked (e.g. Copper Ore → gatherable tier 0, Iron Ingot → vendor tier 0,
Mailbreaker → nested craft tier 4).

## Tuning the "hot" definition

Current default (`src/scoring/hotScore.ts`): selling at least once/day, no
price or margin requirement at all. Ranking is sorted by raw sale velocity.
Note this means very cheap catalyst-type items (common crafting mats) that
move in bulk can still dominate the list precisely because they're cheap and
easy to buy/sell in volume - the base elemental shards/crystals/clusters can
be excluded via the `elemental` tag (see [Tags](#tags-srctagsts)) since
they're overwhelmingly bot-driven, but it's opt-in, not filtered by default.
If other cheap-and-frequent items still turn out to be noise rather than
signal, a `minAveragePrice` floor can be re-added to `ScoringOptions`.
