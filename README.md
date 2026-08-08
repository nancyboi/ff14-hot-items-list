# FF14 Hot Items List

Finds FFXIV market board items on a given world that are moving in high
volume *right now* - price is not a factor, only sale velocity - then ranks
them by how easy they'd be for you to actually go supply (gather it yourself
vs. a multi-step craft), with filters for which gathering/sourcing method you
care about (mining, botany, fishing, vendor, crafted, or likely-drop).

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
4. **AI blurbs** (optional, `src/ai/blurbs.ts`) — the ranking and effort tiers
   above are deterministic. If you pass `--ai-blurbs` (and set
   `ANTHROPIC_API_KEY`), Claude writes one short plain-English sentence per
   item summarizing why it's hot and how easy it is to get - a summarization
   step on top of numbers we've already computed, not the thing doing the
   ranking.
5. **Dashboard** (`public/`) — a static page that reads `data/hot-items.json`
   and renders a sortable-by-eye table with price/velocity/source per item.

## Setup

```bash
npm install
npm run build:sourcing   # builds data/item-sourcing.json from datamining CSVs (run once, re-run after game patches)
```

## Usage

```bash
npm run generate -- --world=Siren
npm run serve
# open http://localhost:4173
```

Options for `generate`:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--world` | `Siren` | Universalis world name to scan |
| `--limit` | `25` | Max items in the final list |
| `--candidates` | `200` | How many recently-updated items to pull stats for before scoring |
| `--ai-blurbs` | off | Have Claude write a one-line note per item (requires `ANTHROPIC_API_KEY`, see `.env.example`) |
| `--source` | off (all) | Only include items sourced this way: `mining`, `botany`, `fishing`, `vendor`, `crafted`, `drop` (no known source - likely a monster drop). Omit or pass `--source=all` for every hot item regardless of source. |

Refresh is manual by design right now - re-run `npm run generate` whenever you
want an updated list. A scheduler (cron/GitHub Action) can be added later if
that becomes annoying.

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
  effect.
- Watch for rate-limit responses; `MAX_IDS_PER_REQUEST` /
  `DELAY_BETWEEN_BATCHES_MS` in `client.ts` are conservative placeholders.

The sourcing dataset (`npm run build:sourcing`) has been run for real and
spot-checked (e.g. Copper Ore → gatherable tier 0, Iron Ingot → vendor tier 0,
Mailbreaker → nested craft tier 4).

## Tuning the "hot" definition

Current default (`src/scoring/hotScore.ts`): selling at least once/day, no
price or margin requirement at all. Ranking is sorted by raw sale velocity.
Note this means very cheap catalyst-type items (shards, crystals, common crafting
mats) that move in bulk can dominate the list precisely because they're cheap
and easy to buy/sell in volume - if that turns out to be noise rather than
signal for what you're after, a `minAveragePrice` floor can be re-added to
`ScoringOptions`.
