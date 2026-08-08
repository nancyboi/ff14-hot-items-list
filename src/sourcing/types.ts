export interface SourcingInfo {
  itemId: number;
  name: string;
  gatherable: boolean;
  vendor: boolean;
  craftable: boolean;
  /** Crafting job names involved, if craftable via any recipe (e.g. "Cooking", "Alchemy"). */
  craftJobs: string[];
  /** Gathering job(s) that can pull this item directly (e.g. "Miner", "Botanist"); empty if not gatherable. */
  gatherJobs: string[];
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
