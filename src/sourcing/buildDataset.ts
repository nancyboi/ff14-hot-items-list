// Builds data/item-sourcing.json from the community FFXIV datamining CSVs
// (https://github.com/xivapi/ffxiv-datamining), so we know which market board
// items are simple gathers/vendor buys vs. multi-step crafts. Universalis has
// no sourcing data of its own - this is a separate, static dataset joined in
// at report-generation time. Re-run this after game patches to pick up new items.
//
// Usage: npm run build:sourcing

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseCsv, toRecords } from "./csv.js";
import type { RecipeInfo, SourcingDataset, SourcingInfo } from "./types.js";

const RAW_BASE = "https://raw.githubusercontent.com/xivapi/ffxiv-datamining/master/csv/en";
const OUTPUT_PATH = fileURLToPath(new URL("../../data/item-sourcing.json", import.meta.url));

async function fetchRecords(csvName: string): Promise<Record<string, string>[]> {
  const res = await fetch(`${RAW_BASE}/${csvName}.csv`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${csvName}.csv: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const { header, rows } = parseCsv(text);
  return toRecords(header, rows);
}

interface Recipe {
  craftType: number;
  ingredients: number[];
  level: number;
}

function toInt(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

/** Reads a column that must exist and be non-empty for at least some rows; throws with the
 *  actual header if the column name is wrong, instead of silently defaulting to 0 everywhere. */
function requireColumn(rows: Record<string, string>[], csvName: string, column: string): void {
  const firstRow = rows[0];
  if (!firstRow) return;
  if (!(column in firstRow)) {
    throw new Error(
      `Expected column "${column}" in ${csvName}.csv but it wasn't found. Actual header: ${Object.keys(firstRow).join(", ")}`,
    );
  }
}

// CraftType.csv "Name" is the crafting discipline (e.g. "Clothcraft", "Cooking"), not the job
// name players use (e.g. "Weaver", "Culinarian"). Map to job names so this lines up with
// gatherJobs and with how PLAYER_LEVELS is keyed.
const CRAFT_JOB_BY_TYPE_NAME: Record<string, string> = {
  Woodworking: "Carpenter",
  Smithing: "Blacksmith",
  Armorcraft: "Armorer",
  Goldsmithing: "Goldsmith",
  Leatherworking: "Leatherworker",
  Clothcraft: "Weaver",
  Alchemy: "Alchemist",
  Cooking: "Culinarian",
};

function computeEffortTier(
  itemId: number,
  recipesByResult: Map<number, Recipe[]>,
  gatherableIds: Set<number>,
  vendorIds: Set<number>,
  memo: Map<number, number | null>,
  stack: Set<number>,
): number | null {
  if (memo.has(itemId)) return memo.get(itemId)!;
  if (stack.has(itemId)) return null; // shouldn't happen in real game data; guards against bad recipe cycles

  const baseTier = gatherableIds.has(itemId) || vendorIds.has(itemId) ? 0 : null;
  if (baseTier === 0) {
    memo.set(itemId, 0);
    return 0;
  }

  const recipes = recipesByResult.get(itemId);
  if (!recipes || recipes.length === 0) {
    memo.set(itemId, null);
    return null;
  }

  stack.add(itemId);
  let bestCraftTier: number | null = null;
  for (const recipe of recipes) {
    let maxIngredientTier = 0;
    for (const ingredientId of recipe.ingredients) {
      const ingredientTier = computeEffortTier(
        ingredientId,
        recipesByResult,
        gatherableIds,
        vendorIds,
        memo,
        stack,
      );
      // Unknown-sourced ingredients (e.g. rare quest/seasonal items) aren't counted against
      // the recipe - we don't want one untracked ingredient to hide an otherwise-simple craft.
      if (ingredientTier !== null) {
        maxIngredientTier = Math.max(maxIngredientTier, ingredientTier);
      }
    }
    const thisRecipeTier = 1 + maxIngredientTier;
    if (bestCraftTier === null || thisRecipeTier < bestCraftTier) {
      bestCraftTier = thisRecipeTier;
    }
  }
  stack.delete(itemId);

  memo.set(itemId, bestCraftTier);
  return bestCraftTier;
}

// GatheringType.csv row # -> the DoL job that uses that node type. Mining/Quarrying nodes
// are both worked with a pickaxe (Miner); Logging/Harvesting are both Botanist. Fishing is a
// separate system entirely (FishParameter/SpearfishingItem), handled below.
const GATHER_JOB_BY_TYPE: Record<number, string> = {
  0: "Miner", // Mining
  1: "Miner", // Quarrying
  2: "Botanist", // Logging
  3: "Botanist", // Harvesting
};

async function main() {
  console.log("Fetching FFXIV datamining CSVs...");
  const [
    itemRows,
    gatheringRows,
    vendorRows,
    recipeRows,
    recipeLevelTableRows,
    craftTypeRows,
    gatheringPointBaseRows,
    gatheringItemLevelRows,
    fishParameterRows,
    spearfishingItemRows,
  ] = await Promise.all([
    fetchRecords("Item"),
    fetchRecords("GatheringItem"),
    fetchRecords("GilShopItem"),
    fetchRecords("Recipe"),
    fetchRecords("RecipeLevelTable"),
    fetchRecords("CraftType"),
    fetchRecords("GatheringPointBase"),
    fetchRecords("GatheringItemLevelConvertTable"),
    fetchRecords("FishParameter"),
    fetchRecords("SpearfishingItem"),
  ]);
  console.log(
    `Loaded Item(${itemRows.length}) GatheringItem(${gatheringRows.length}) GilShopItem(${vendorRows.length}) Recipe(${recipeRows.length}) RecipeLevelTable(${recipeLevelTableRows.length}) CraftType(${craftTypeRows.length}) GatheringPointBase(${gatheringPointBaseRows.length}) GatheringItemLevelConvertTable(${gatheringItemLevelRows.length}) FishParameter(${fishParameterRows.length}) SpearfishingItem(${spearfishingItemRows.length})`,
  );

  requireColumn(recipeRows, "Recipe", "RecipeLevelTable");
  requireColumn(recipeLevelTableRows, "RecipeLevelTable", "ClassJobLevel");
  requireColumn(gatheringRows, "GatheringItem", "GatheringItemLevel");
  requireColumn(gatheringItemLevelRows, "GatheringItemLevelConvertTable", "GatheringItemLevel");
  requireColumn(fishParameterRows, "FishParameter", "GatheringItemLevel");
  requireColumn(spearfishingItemRows, "SpearfishingItem", "GatheringItemLevel");

  // RecipeLevelTable.csv "#" -> ClassJobLevel (the actual required job level for that table row).
  const classJobLevelByRecipeLevelTable = new Map<number, number>();
  for (const row of recipeLevelTableRows) {
    classJobLevelByRecipeLevelTable.set(toInt(row["#"]), toInt(row["ClassJobLevel"]));
  }

  // GatheringItemLevelConvertTable.csv "#" -> GatheringItemLevel (the actual required gatherer
  // level). GatheringItem/FishParameter/SpearfishingItem's own "GatheringItemLevel" column is
  // just a foreign key into this table, not the level itself.
  const gatherLevelByConvertTableId = new Map<number, number>();
  for (const row of gatheringItemLevelRows) {
    gatherLevelByConvertTableId.set(toInt(row["#"]), toInt(row["GatheringItemLevel"]));
  }

  const itemNames = new Map<number, string>();
  for (const row of itemRows) {
    const id = toInt(row["#"]);
    const name = row["Name"]?.trim();
    if (id > 0 && name) itemNames.set(id, name);
  }

  const gatherableIds = new Set<number>();
  // GatheringItem.csv "#" is a separate ID space from the real item ID (its "Item" column) -
  // GatheringPointBase references gathering items by that "#", so we need the reverse map to
  // resolve gathering nodes back to real items. GatheringItemLevel is itself a foreign key into
  // GatheringItemLevelConvertTable, resolved via gatherLevelByConvertTableId above.
  const realItemIdByGatheringItemId = new Map<number, number>();
  const gatherLevelByGatheringItemId = new Map<number, number>();
  for (const row of gatheringRows) {
    const gatheringItemId = toInt(row["#"]);
    const itemId = toInt(row["Item"]);
    if (itemId > 0) {
      gatherableIds.add(itemId);
      realItemIdByGatheringItemId.set(gatheringItemId, itemId);
      const level = gatherLevelByConvertTableId.get(toInt(row["GatheringItemLevel"]));
      if (level !== undefined) gatherLevelByGatheringItemId.set(gatheringItemId, level);
    }
  }

  const gatherJobsByItem = new Map<number, Set<string>>();
  // job -> real item id -> lowest node level at which that job can gather this item.
  const gatherLevelsByItem = new Map<number, Map<string, number>>();
  function recordGatherLevel(itemId: number, job: string, level: number) {
    const levels = gatherLevelsByItem.get(itemId) ?? new Map<string, number>();
    const existing = levels.get(job);
    if (existing === undefined || level < existing) levels.set(job, level);
    gatherLevelsByItem.set(itemId, levels);
  }

  const gatheringItemColumns = Array.from({ length: 8 }, (_, i) => `Item[${i}]`);
  for (const row of gatheringPointBaseRows) {
    const job = GATHER_JOB_BY_TYPE[toInt(row["GatheringType"])];
    if (!job) continue;
    for (const col of gatheringItemColumns) {
      const gatheringItemId = toInt(row[col]);
      if (gatheringItemId <= 0) continue;
      const realItemId = realItemIdByGatheringItemId.get(gatheringItemId);
      if (!realItemId) continue;
      const jobs = gatherJobsByItem.get(realItemId) ?? new Set<string>();
      jobs.add(job);
      gatherJobsByItem.set(realItemId, jobs);
      const level = gatherLevelByGatheringItemId.get(gatheringItemId);
      if (level !== undefined) recordGatherLevel(realItemId, job, level);
    }
  }

  // Fishing (rod) and spearfishing both give Item directly, no indirection needed.
  for (const row of fishParameterRows) {
    const itemId = toInt(row["Item"]);
    if (itemId <= 0) continue;
    gatherableIds.add(itemId);
    const jobs = gatherJobsByItem.get(itemId) ?? new Set<string>();
    jobs.add("Fisher");
    gatherJobsByItem.set(itemId, jobs);
    const level = gatherLevelByConvertTableId.get(toInt(row["GatheringItemLevel"]));
    if (level !== undefined) recordGatherLevel(itemId, "Fisher", level);
  }
  for (const row of spearfishingItemRows) {
    const itemId = toInt(row["Item"]);
    if (itemId <= 0) continue;
    gatherableIds.add(itemId);
    const jobs = gatherJobsByItem.get(itemId) ?? new Set<string>();
    jobs.add("Fisher");
    gatherJobsByItem.set(itemId, jobs);
    const level = gatherLevelByConvertTableId.get(toInt(row["GatheringItemLevel"]));
    if (level !== undefined) recordGatherLevel(itemId, "Fisher", level);
  }

  const vendorIds = new Set<number>();
  for (const row of vendorRows) {
    const itemId = toInt(row["Item"]);
    if (itemId > 0) vendorIds.add(itemId);
  }

  const craftTypeNames = new Map<number, string>();
  for (const row of craftTypeRows) {
    const typeName = row["Name"]?.trim() || `CraftType ${row["#"]}`;
    craftTypeNames.set(toInt(row["#"]), CRAFT_JOB_BY_TYPE_NAME[typeName] ?? typeName);
  }

  const recipesByResult = new Map<number, Recipe[]>();
  const ingredientColumns = Array.from({ length: 8 }, (_, i) => `Ingredient[${i}]`);
  for (const row of recipeRows) {
    const resultId = toInt(row["ItemResult"]);
    if (resultId <= 0) continue;
    const ingredients = [...new Set(ingredientColumns.map((col) => toInt(row[col])).filter((id) => id > 0))];
    const level = classJobLevelByRecipeLevelTable.get(toInt(row["RecipeLevelTable"])) ?? 0;
    const recipe: Recipe = { craftType: toInt(row["CraftType"]), ingredients, level };
    const list = recipesByResult.get(resultId) ?? [];
    list.push(recipe);
    recipesByResult.set(resultId, list);
  }

  console.log("Computing effort tiers...");
  const memo = new Map<number, number | null>();
  const dataset: SourcingDataset = {};

  for (const [itemId, name] of itemNames) {
    const recipes = recipesByResult.get(itemId);
    const craftJobs = recipes
      ? [...new Set(recipes.map((r) => craftTypeNames.get(r.craftType) ?? `CraftType ${r.craftType}`))]
      : [];
    const recipeInfos: RecipeInfo[] = (recipes ?? []).map((r) => ({
      craftJob: craftTypeNames.get(r.craftType) ?? `CraftType ${r.craftType}`,
      level: r.level,
      ingredients: r.ingredients,
    }));
    const gatherLevels = Object.fromEntries(gatherLevelsByItem.get(itemId) ?? []);
    const info: SourcingInfo = {
      itemId,
      name,
      gatherable: gatherableIds.has(itemId),
      vendor: vendorIds.has(itemId),
      craftable: Boolean(recipes && recipes.length > 0),
      craftJobs,
      gatherJobs: [...(gatherJobsByItem.get(itemId) ?? [])],
      gatherLevels,
      recipes: recipeInfos,
      effortTier: computeEffortTier(itemId, recipesByResult, gatherableIds, vendorIds, memo, new Set()),
    };
    dataset[itemId] = info;
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(dataset), "utf8");
  console.log(`Wrote ${Object.keys(dataset).length} items to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
