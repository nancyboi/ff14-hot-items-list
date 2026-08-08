// Pulls current market data for a world from Universalis, scores items for
// "hotness" (pure sale volume - price is not a factor), joins in the static
// gather/craft sourcing dataset, and writes data/hot-items.json for the
// dashboard to read.
//
// Usage:
//   npm run generate -- --world=Siren
//   npm run generate -- --world=Siren --limit=15 --ai-blurbs
//
// Requires `npm run build:sourcing` to have been run at least once.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getMarketData, getMostRecentlyUpdatedItemIds } from "./universalis/client.js";
import { scoreItems, type ScoringOptions } from "./scoring/hotScore.js";
import type { SourcingDataset } from "./sourcing/types.js";

const SOURCING_PATH = fileURLToPath(new URL("../data/item-sourcing.json", import.meta.url));
const OUTPUT_PATH = fileURLToPath(new URL("../data/hot-items.json", import.meta.url));

export interface HotListEntry {
  itemId: number;
  name: string;
  currentAveragePrice: number;
  averagePrice: number;
  priceRatio: number;
  regularSaleVelocity: number;
  minListingPrice: number | null;
  hotScore: number;
  gatherable: boolean;
  vendor: boolean;
  craftable: boolean;
  craftJobs: string[];
  gatherJobs: string[];
  effortTier: number | null;
  blurb?: string;
}

export type SourceFilter = "mining" | "botany" | "fishing" | "vendor" | "crafted" | "drop";

const SOURCE_FILTERS: Record<SourceFilter, (info: SourcingDataset[number] | undefined) => boolean> = {
  mining: (info) => Boolean(info?.gatherJobs.includes("Miner")),
  botany: (info) => Boolean(info?.gatherJobs.includes("Botanist")),
  fishing: (info) => Boolean(info?.gatherJobs.includes("Fisher")),
  vendor: (info) => Boolean(info?.vendor),
  crafted: (info) => Boolean(info?.craftable),
  // Not gatherable/vendor/craftable by any tracked source - most likely a monster drop,
  // quest reward, or other source this dataset doesn't have data for (see SourcingInfo.effortTier).
  drop: (info) => Boolean(info && !info.gatherable && !info.vendor && !info.craftable),
};

interface Args {
  world: string;
  limit: number;
  candidates: number;
  aiBlurbs: boolean;
  /** Restrict results to items sourced this way (e.g. "mining"); null disables the filter. */
  source: SourceFilter | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { world: "Siren", limit: 25, candidates: 200, aiBlurbs: false, source: null };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "world" && value) args.world = value;
    else if (key === "limit" && value) args.limit = Number(value);
    else if (key === "candidates" && value) args.candidates = Number(value);
    else if (key === "ai-blurbs") args.aiBlurbs = true;
    else if (key === "source") {
      if (!value || value.toLowerCase() === "all") {
        args.source = null;
      } else if (value.toLowerCase() in SOURCE_FILTERS) {
        args.source = value.toLowerCase() as SourceFilter;
      } else {
        throw new Error(
          `Unknown --source value "${value}". Expected one of: ${Object.keys(SOURCE_FILTERS).join(", ")}, all`,
        );
      }
    }
  }
  return args;
}

async function loadSourcingDataset(): Promise<SourcingDataset> {
  try {
    const text = await readFile(SOURCING_PATH, "utf8");
    return JSON.parse(text) as SourcingDataset;
  } catch (err) {
    throw new Error(
      `Couldn't read ${SOURCING_PATH}. Run \`npm run build:sourcing\` first to generate it.\n${err}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Fetching most recently updated items for ${args.world}...`);
  const candidateIds = await getMostRecentlyUpdatedItemIds(args.world, args.candidates);
  console.log(`Got ${candidateIds.length} candidates. Fetching market data...`);

  const marketData = await getMarketData(args.world, candidateIds, {
    onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total} items fetched`),
  });
  console.log();

  const scoringOptions: ScoringOptions = {};
  const scored = scoreItems([...marketData.values()], scoringOptions);
  console.log(`${scored.length} items are selling at all (ranked by sale volume).`);

  const sourcing = await loadSourcingDataset();

  // Filter before slicing to `limit` - otherwise a source filter could zero out an
  // already-truncated top-N instead of digging further into the scored list.
  let filteredScored = scored;
  if (args.source) {
    const matches = SOURCE_FILTERS[args.source];
    filteredScored = scored.filter((s) => matches(sourcing[s.itemId]));
    console.log(`${filteredScored.length} of those are sourced via ${args.source}.`);
  }

  const entries: HotListEntry[] = filteredScored.slice(0, args.limit).map((s) => {
    const info = sourcing[s.itemId];
    return {
      itemId: s.itemId,
      name: info?.name ?? `Item #${s.itemId}`,
      currentAveragePrice: s.currentAveragePrice,
      averagePrice: s.averagePrice,
      priceRatio: s.priceRatio,
      regularSaleVelocity: s.regularSaleVelocity,
      minListingPrice: s.minListingPrice,
      hotScore: s.hotScore,
      gatherable: info?.gatherable ?? false,
      vendor: info?.vendor ?? false,
      craftable: info?.craftable ?? false,
      craftJobs: info?.craftJobs ?? [],
      gatherJobs: info?.gatherJobs ?? [],
      effortTier: info?.effortTier ?? null,
    };
  });

  if (args.aiBlurbs) {
    console.log("Generating AI blurbs...");
    const { generateBlurbs } = await import("./ai/blurbs.js");
    const blurbs = await generateBlurbs(entries);
    for (const entry of entries) {
      entry.blurb = blurbs.get(entry.itemId);
    }
  }

  const output = {
    world: args.world,
    generatedAt: new Date().toISOString(),
    items: entries,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${entries.length} items to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
