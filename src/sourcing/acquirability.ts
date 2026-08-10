// Level-aware "can I actually get this item with my current jobs" check, layered on top of the
// static sourcing dataset (which only records *whether* something is gatherable/craftable, plus
// the levels/jobs required). Player levels are supplied by the caller (see config/playerLevels.ts)
// so this file has no knowledge of any particular person's characters.

import type { SourcingDataset, SourcingInfo } from "./types.js";
import { JOB_ABBR } from "../jobs.js";

export type PlayerLevels = Record<string, number>;

export interface AcquireResult {
  /** True if the item can be obtained at all: gathered/vendor-bought directly, or crafted by a
   *  job I have at the required level (ingredients may need to be bought off the market board). */
  acquirable: boolean;
  /** True if, in addition to being acquirable, every ingredient (recursively) is also something
   *  I can gather/vendor-buy/craft myself - no trip to the market board required. */
  selfSufficient: boolean;
  /** Human-readable reason acquirability succeeded or the closest reason it failed, e.g.
   *  "MIN 50 node", "WVR 45 recipe", "WVR 45 recipe (buy mats)", or null if nothing applies. */
  reason: string | null;
}

const NOT_ACQUIRABLE: AcquireResult = { acquirable: false, selfSufficient: false, reason: null };

function playerLevel(playerLevels: PlayerLevels, job: string): number {
  return playerLevels[job] ?? 0;
}

/** Whether an item has *any* known source in the dataset, ignoring player levels entirely -
 *  used to decide if a recipe ingredient could plausibly be bought off the market board. */
function hasAnyKnownSource(info: SourcingInfo | undefined): boolean {
  if (!info) return false;
  return info.gatherable || info.vendor || info.craftable;
}

/** Whether `job` specifically (gathering or crafting - not vendor, not any other job) can get this
 *  item at the player's current level for that job. Used to enforce level requirements when the
 *  caller has filtered down to a specific job tag, so a vendor-available or other-job-craftable
 *  item doesn't slip through a level-5 Leatherworker's results just because it's a global "yes"
 *  via computeAcquirability's vendor/any-job shortcut. */
export function canObtainViaJob(info: SourcingInfo | undefined, job: string, playerLevels: PlayerLevels): boolean {
  if (!info) return false;
  const level = playerLevel(playerLevels, job);
  const gatherLevel = info.gatherLevels[job];
  if (gatherLevel !== undefined && level >= gatherLevel) return true;
  return info.recipes.some((recipe) => recipe.craftJob === job && level >= recipe.level);
}

export function computeAcquirability(
  itemId: number,
  dataset: SourcingDataset,
  playerLevels: PlayerLevels,
  memo: Map<number, AcquireResult>,
  stack: Set<number>,
): AcquireResult {
  const cached = memo.get(itemId);
  if (cached) return cached;
  if (stack.has(itemId)) return NOT_ACQUIRABLE; // cycle guard, shouldn't happen in real data

  const info = dataset[itemId];
  if (!info) {
    memo.set(itemId, NOT_ACQUIRABLE);
    return NOT_ACQUIRABLE;
  }

  if (info.vendor) {
    const result: AcquireResult = { acquirable: true, selfSufficient: true, reason: "vendor" };
    memo.set(itemId, result);
    return result;
  }

  let bestGatherGap: { job: string; level: number } | null = null;
  for (const [job, level] of Object.entries(info.gatherLevels)) {
    if (playerLevel(playerLevels, job) >= level) {
      const result: AcquireResult = {
        acquirable: true,
        selfSufficient: true,
        reason: `${JOB_ABBR[job] ?? job} ${level} node`,
      };
      memo.set(itemId, result);
      return result;
    }
    const gap = level - playerLevel(playerLevels, job);
    if (!bestGatherGap || gap < bestGatherGap.level - playerLevel(playerLevels, bestGatherGap.job)) {
      bestGatherGap = { job, level };
    }
  }

  if (!info.recipes || info.recipes.length === 0) {
    const reason = bestGatherGap ? `${JOB_ABBR[bestGatherGap.job] ?? bestGatherGap.job} ${bestGatherGap.level} node` : null;
    const result: AcquireResult = { acquirable: false, selfSufficient: false, reason };
    memo.set(itemId, result);
    return result;
  }

  stack.add(itemId);

  let selfSufficientReason: string | null = null;
  let mbAssistedReason: string | null = null;
  let bestCraftGap: { job: string; level: number } | null = null;

  for (const recipe of info.recipes) {
    if (playerLevel(playerLevels, recipe.craftJob) < recipe.level) {
      const gap = recipe.level - playerLevel(playerLevels, recipe.craftJob);
      if (!bestCraftGap || gap < bestCraftGap.level - playerLevel(playerLevels, bestCraftGap.job)) {
        bestCraftGap = { job: recipe.craftJob, level: recipe.level };
      }
      continue;
    }

    const reasonLabel = `${JOB_ABBR[recipe.craftJob] ?? recipe.craftJob} ${recipe.level} recipe`;

    if (!mbAssistedReason) {
      const allIngredientsKnown = recipe.ingredients.every((id) => hasAnyKnownSource(dataset[id]));
      if (allIngredientsKnown) mbAssistedReason = `${reasonLabel} (buy mats)`;
    }

    if (!selfSufficientReason) {
      const allIngredientsSelfSufficient = recipe.ingredients.every(
        (id) => computeAcquirability(id, dataset, playerLevels, memo, stack).selfSufficient,
      );
      if (allIngredientsSelfSufficient) selfSufficientReason = reasonLabel;
    }
  }

  stack.delete(itemId);

  if (selfSufficientReason) {
    const result: AcquireResult = { acquirable: true, selfSufficient: true, reason: selfSufficientReason };
    memo.set(itemId, result);
    return result;
  }
  if (mbAssistedReason) {
    const result: AcquireResult = { acquirable: true, selfSufficient: false, reason: mbAssistedReason };
    memo.set(itemId, result);
    return result;
  }

  const gapReason = bestCraftGap
    ? `${JOB_ABBR[bestCraftGap.job] ?? bestCraftGap.job} ${bestCraftGap.level} recipe`
    : bestGatherGap
      ? `${JOB_ABBR[bestGatherGap.job] ?? bestGatherGap.job} ${bestGatherGap.level} node`
      : null;
  const result: AcquireResult = { acquirable: false, selfSufficient: false, reason: gapReason };
  memo.set(itemId, result);
  return result;
}
