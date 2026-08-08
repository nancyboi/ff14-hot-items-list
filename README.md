# FF14 Hot Items List

Finds FFXIV market board items on a given world that are currently selling for
more than usual **and** moving faster than usual, then ranks them by how easy
they'd be for you to actually go supply (gather it yourself vs. a multi-step
craft).

## How it works

1. **Universalis** (`src/universalis/`) — pulls the item IDs with the freshest
   market activity on a world (`/extra/stats/most-recently-updated`), then
   fetches current listings, sale history, average price, and sale velocity
   for those items in batches.
2. **Scoring** (`src/scoring/hotScore.ts`) — an item is "hot" if its current
   asking price is meaningfully above its own historical average (`priceRatio`)
   *and* it's selling faster than most other candidates fetched this run
   (`velocityPercentile`, ranked relative to the batch rather than a fixed
   number, since normal sale volume varies wildly by item type).
3. **Sourcing / effort** (`src/sourcing/`) — a separate, static dataset built
   from the community [FFXIV datamining CSVs](https://github.com/xivapi/ffxiv-datamining)
   (Universalis has no recipe/gathering data of its own). Every item gets an
   `effortTier`:
   - `0` — gatherable directly and/or vendor-bought
   - `1` — craftable from only gatherable/vendor ingredients (one step)
   - `2+` — craftable, but at least one ingredient is itself a craft (the
     number is the nesting depth)
   - `null` — not gatherable, not vendor-bought, not any known recipe's
     result — likely a drop or quest reward. Treat as "unknown", not "easy".
4. **AI blurbs** (optional, `src/ai/blurbs.ts`) — the ranking and effort tiers
   above are deterministic. If you pass `--ai-blurbs` (and set
   `ANTHROPIC_API_KEY`), Claude writes one short plain-English sentence per
   item summarizing why it's hot and how easy it is to get - a summarization
   step on top of numbers we've already computed, not the thing doing the
   ranking.
5. **Dashboard** (`public/`) — a static page that reads `data/hot-items.json`
   and renders a sortable-by-eye table with price/velocity/effort per item.

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

Refresh is manual by design right now - re-run `npm run generate` whenever you
want an updated list. A scheduler (cron/GitHub Action) can be added later if
that becomes annoying.

## Notes / things to verify with a live run

This was scaffolded in a sandboxed environment that could reach GitHub (used
to build the real sourcing dataset from live datamining CSVs) but had
`universalis.app` blocked by network policy, so `src/universalis/client.ts`
could not be exercised against the real API yet. Before relying on it:

- Confirm field names in `src/universalis/types.ts` against a real response
  from `GET /api/v2/{world}/{itemIds}` (docs: https://docs.universalis.app/).
- Confirm the shape of `/extra/stats/most-recently-updated` and whether
  `entries` has a max cap.
- Watch for rate-limit responses; `MAX_IDS_PER_REQUEST` /
  `DELAY_BETWEEN_BATCHES_MS` in `client.ts` are conservative placeholders.

The sourcing dataset (`npm run build:sourcing`) has been run for real and
spot-checked (e.g. Copper Ore → gatherable tier 0, Iron Ingot → vendor tier 0,
Mailbreaker → nested craft tier 4).

## Tuning the "hot" definition

Current defaults (`src/scoring/hotScore.ts`): price at least 15% above its own
7-day-ish historical average (whatever Universalis' default stats window is),
selling at least once/day, average price at least 50 gil (filters out junk).
These are starting points, not tuned against real data yet - once you've run
this against live Siren data for a bit, adjust `ScoringOptions` based on what
actually looks "hot" vs. noise.
