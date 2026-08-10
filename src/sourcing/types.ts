export interface RecipeInfo {
  /** DoH job name required to craft this recipe (e.g. "Weaver", "Culinarian"). */
  craftJob: string;
  /** Minimum class/job level required to craft this recipe (Recipe.RecipeLevelTable -> RecipeLevelTable.ClassJobLevel). */
  level: number;
  /** Real item IDs of every ingredient this recipe consumes. */
  ingredients: number[];
}

export interface SourcingInfo {
  itemId: number;
  name: string;
  gatherable: boolean;
  vendor: boolean;
  craftable: boolean;
  /** DoH job names involved, if craftable via any recipe (e.g. "Weaver", "Culinarian"). */
  craftJobs: string[];
  /** Gathering job(s) that can pull this item directly (e.g. "Miner", "Botanist"); empty if not gatherable. */
  gatherJobs: string[];
  /**
   * Minimum required gathering level per job that can pull this item directly, e.g. { Miner: 50 }.
   * If a job can gather the item from multiple nodes, this is the lowest of those node levels.
   * Empty if not gatherable.
   */
  gatherLevels: Record<string, number>;
  /** Every recipe that produces this item, with the job/level/ingredients needed for level-aware acquirability checks. */
  recipes: RecipeInfo[];
  /**
   * 0 = gatherable directly and/or vendor-bought (no crafting needed)
   * 1 = craftable from only gatherable/vendor ingredients (one step)
   * 2+ = craftable, but at least one ingredient is itself a craft (nested - the number is craft depth)
   * null = not gatherable, not vendor-bought, not any recipe's result - likely a drop, quest reward,
   *        or other source this dataset doesn't track. Treat as "unknown effort", not "easy".
   */
  effortTier: number | null;
}

export type SourcingDataset = Record<number, SourcingInfo>;
