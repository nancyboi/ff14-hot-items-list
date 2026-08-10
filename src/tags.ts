// Canonical tag registry for the "how do I get this item" facet of an item: three
// source-shape tags (gathered/crafted/vendor) plus one tag per job that can gather or
// craft it. Shared by src/generate.ts (filtering + attaching tags to results) and
// src/server.ts (GET /api/tags, so the web UI can build the filter chips from the same list).

import { ALL_JOBS } from "./jobs.js";
import type { SourcingInfo } from "./sourcing/types.js";

export interface TagDef {
  id: string;
  label: string;
  category: "source" | "gather" | "craft" | "misc";
}

export const SOURCE_TAGS: TagDef[] = [
  { id: "gathered", label: "Gathered", category: "source" },
  { id: "crafted", label: "Crafted", category: "source" },
  { id: "vendor", label: "Vendor", category: "source" },
];

// Job tag ids are the job's full name (matches SourcingInfo.gatherJobs/craftJobs entries).
export const JOB_TAGS: TagDef[] = ALL_JOBS.map((job) => ({
  id: job.name,
  label: job.abbr,
  category: job.category,
}));

// The 18 base elemental crafting materials (Fire/Ice/Wind/Earth/Lightning/Water x
// Shard/Crystal/Cluster, item IDs 2-19). These trade in huge, constant volume - largely bot
// activity, not real player demand - and drown out everything else in a sale-velocity ranking,
// so they get their own tag to filter out rather than being matched by name (lots of unrelated
// items have "Crystal"/"Shard"/"Cluster" in their name, e.g. "Crystal Chandelier").
export const ELEMENTAL_ITEM_IDS: Set<number> = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

export const MISC_TAGS: TagDef[] = [
  { id: "elemental", label: "Elemental", category: "misc" },
];

export const ALL_TAGS: TagDef[] = [...SOURCE_TAGS, ...JOB_TAGS, ...MISC_TAGS];

export const TAG_IDS: Set<string> = new Set(ALL_TAGS.map((t) => t.id));
export const JOB_TAG_IDS: Set<string> = new Set(JOB_TAGS.map((t) => t.id));

/** Every tag that applies to an item: source-shape tags, one per job that can gather/craft it,
 *  plus "elemental" for the base shard/crystal/cluster currencies. */
export function tagsForItem(info: SourcingInfo | undefined): string[] {
  if (!info) return [];
  const tags: string[] = [];
  if (info.gatherable) tags.push("gathered");
  if (info.craftable) tags.push("crafted");
  if (info.vendor) tags.push("vendor");
  tags.push(...info.gatherJobs, ...info.craftJobs);
  if (ELEMENTAL_ITEM_IDS.has(info.itemId)) tags.push("elemental");
  return tags;
}
