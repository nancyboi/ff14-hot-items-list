// Pulls current market data for a world from Universalis, scores items for
// "hotness" (pure sale volume over a chosen time window - price is not a factor),
// joins in the static gather/craft sourcing dataset, and writes data/hot-items.json
// for the dashboard to read. Also exported as generateHotItems() so the dev server
// (src/server.ts) can run the same pipeline on demand for the web UI's filter form.
//
// Usage:
//   npm run generate -- --world=Siren
//   npm run generate -- --world=Siren --limit=15 --ai-blurbs
//   npm run generate -- --world=Siren --days=30   # "hot" over the past month instead of the past week
//   npm run generate -- --world=Siren --all-levels   # skip the "my levels only" acquirability filter
//
// By default, results are limited to items acquirable with the job levels in PLAYER_LEVELS
// (see src/config/playerLevels.ts). Requires `npm run build:sourcing` to have been run at least once.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getMarketData, getMostRecentlyUpdatedItemIds, getSalesHistory } from "./universalis/client.js";
import { scoreItems, computeVelocityForWindow } from "./scoring/hotScore.js";
import type { SourcingDataset } from "./sourcing/types.js";
import { computeAcquirability, canObtainViaJob, type AcquireResult, type PlayerLevels } from "./sourcing/acquirability.js";
import { loadPlayerLevels } from "./config/playerLevels.js";
import { tagsForItem, TAG_IDS, JOB_TAG_IDS } from "./tags.js";

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
  /** Source-shape tags ("gathered"/"crafted"/"vendor") plus one tag per job that can get this item (see src/tags.ts). */
  tags: string[];
  blurb?: string;
}

export interface HotListOutput {
  world: string;
  generatedAt: string;
  days: number;
  myLevelsOnly: boolean;
  /** Tag ids (see src/tags.ts); an item must have at least one to be included. */
  includeTags?: string[];
  /** Tag ids; an item with any of these is dropped. */
  excludeTags?: string[];
  playerLevels: PlayerLevels;
  items: HotListEntry[];
}

export interface GenerateOptions {
  world: string;
  limit: number;
  candidates: number;
  /** Sale-velocity window in days, e.g. 1 (day), 7 (week), 30 (month). */
  days: number;
  aiBlurbs: boolean;
  /** Tag ids (see src/tags.ts); an item must have at least one to be included. */
  includeTags?: string[];
  /** Tag ids; an item with any of these is dropped. */
  excludeTags?: string[];
  /** Drop items that aren't acquirable with `playerLevels`. Default true. */
  myLevelsOnly: boolean;
  /** DoL/DoH job levels to gate acquirability against. Defaults to PLAYER_LEVELS/config default. */
  playerLevels?: PlayerLevels;
  onProgress?: (message: string) => void;
}

export async function loadSourcingDataset(): Promise<SourcingDataset> {
  try {
    const text = await readFile(SOURCING_PATH, "utf8");
    return JSON.parse(text) as SourcingDataset;
  } catch (err) {
    throw new Error(
      `Couldn't read ${SOURCING_PATH}. Run \`npm run build:sourcing\` first to generate it.\n${err}`,
    );
  }
}

/** Runs the full hot-items pipeline (market data -> scoring -> sourcing/acquirability) and
 *  returns the result without touching disk - reused by both the CLI (main, below) and the
 *  dev server's POST /api/search so the web UI's filter form doesn't need a subprocess. */
export async function generateHotItems(options: GenerateOptions): Promise<HotListOutput> {
  const log = options.onProgress ?? (() => {});

  const sourcing = await loadSourcingDataset();
  const playerLevels = options.playerLevels ?? loadPlayerLevels();
  const acquireMemo = new Map<number, AcquireResult>();
  const acquireResult = (itemId: number) =>
    computeAcquirability(itemId, sourcing, playerLevels, acquireMemo, new Set());

  // Universalis's most-recently-updated endpoint hard-caps at 200 results and skews heavily
  // toward frequently-traded endgame items - rarely-traded low-level gear can be genuinely for
  // sale and never appear there no matter how large `candidates` is set. So once we already know
  // which specific job(s) the caller wants and their level, skip the recency guess entirely and
  // pull candidates straight from the sourcing dataset: every item that job can actually obtain
  // at the player's level, then fetch market data for exactly those.
  const jobTagsSelected = (options.includeTags ?? []).filter((t) => JOB_TAG_IDS.has(t));
  const levelFirst = options.myLevelsOnly && jobTagsSelected.length > 0;

  let candidateIds: number[];
  if (levelFirst) {
    log(`Finding items obtainable via ${jobTagsSelected.join(", ")} at your level...`);
    candidateIds = Object.values(sourcing)
      .filter((info) => jobTagsSelected.some((job) => canObtainViaJob(info, job, playerLevels)))
      .map((info) => info.itemId);
    log(`Found ${candidateIds.length} items you can obtain via those jobs. Fetching market data...`);
  } else {
    log(`Fetching most recently updated items for ${options.world}...`);
    candidateIds = await getMostRecentlyUpdatedItemIds(options.world, options.candidates);
    log(`Got ${candidateIds.length} candidates. Fetching market data...`);
  }

  const marketData = await getMarketData(options.world, candidateIds);
  const historyData = await getSalesHistory(options.world, candidateIds);

  const velocityOverrides = new Map<number, number>();
  for (const [itemId, history] of historyData) {
    velocityOverrides.set(itemId, computeVelocityForWindow(history.entries, options.days));
  }

  const scored = scoreItems([...marketData.values()], { velocityOverrides });
  log(`${scored.length} items are selling at all in the last ${options.days} day(s) (ranked by sale volume).`);

  // Filter before slicing to `limit` - otherwise a tag filter could zero out an
  // already-truncated top-N instead of digging further into the scored list.
  let filteredScored = scored;
  if (options.includeTags?.length) {
    const include = options.includeTags;
    filteredScored = filteredScored.filter((s) => tagsForItem(sourcing[s.itemId]).some((t) => include.includes(t)));
    log(`${filteredScored.length} of those match tags: ${include.join(", ")}.`);
  }
  if (options.excludeTags?.length) {
    const exclude = options.excludeTags;
    filteredScored = filteredScored.filter((s) => !tagsForItem(sourcing[s.itemId]).some((t) => exclude.includes(t)));
    log(`${filteredScored.length} of those don't match excluded tags: ${exclude.join(", ")}.`);
  }
  if (options.myLevelsOnly) {
    // If the caller filtered down to specific job tag(s), a level check needs to hold for one of
    // *those* jobs specifically - otherwise a vendor-available or other-job-craftable item would
    // pass via computeAcquirability's global "acquirable by any means" check even though the
    // player's level in the job they actually filtered by doesn't meet the requirement. (Already
    // guaranteed by construction when `levelFirst` sourced the candidates, but cheap to re-check.)
    filteredScored = filteredScored.filter((s) => {
      if (jobTagsSelected.length > 0) {
        const info = sourcing[s.itemId];
        return jobTagsSelected.some((job) => canObtainViaJob(info, job, playerLevels));
      }
      return acquireResult(s.itemId).acquirable;
    });
    log(`${filteredScored.length} of those are acquirable with your current job levels.`);
  }

  const entries: HotListEntry[] = filteredScored.slice(0, options.limit).map((s) => {
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
      tags: tagsForItem(info),
    };
  });

  if (options.aiBlurbs) {
    log("Generating AI blurbs...");
    const { generateBlurbs } = await import("./ai/blurbs.js");
    const blurbs = await generateBlurbs(entries);
    for (const entry of entries) {
      entry.blurb = blurbs.get(entry.itemId);
    }
  }

  return {
    world: options.world,
    generatedAt: new Date().toISOString(),
    days: options.days,
    myLevelsOnly: options.myLevelsOnly,
    includeTags: options.includeTags,
    excludeTags: options.excludeTags,
    playerLevels,
    items: entries,
  };
}

interface Args extends GenerateOptions {}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    world: "Siren",
    limit: 25,
    candidates: 200,
    days: 7,
    aiBlurbs: false,
    includeTags: [],
    excludeTags: [],
    myLevelsOnly: true,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "world" && value) args.world = value;
    else if (key === "limit" && value) args.limit = Number(value);
    else if (key === "candidates" && value) args.candidates = Number(value);
    else if (key === "days" && value) args.days = Number(value);
    else if (key === "ai-blurbs") args.aiBlurbs = true;
    else if (key === "all-levels") args.myLevelsOnly = false;
    else if (key === "include-tags") {
      args.includeTags = value ? value.split(",").filter((t) => TAG_IDS.has(t)) : [];
    } else if (key === "exclude-tags") {
      args.excludeTags = value ? value.split(",").filter((t) => TAG_IDS.has(t)) : [];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = await generateHotItems({ ...args, onProgress: (msg) => console.log(msg) });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${output.items.length} items to ${OUTPUT_PATH}`);
}

// Only run the CLI when this file is executed directly (`npm run generate`) - not when
// src/server.ts imports generateHotItems() to serve the web UI's filter form.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
