import type { UniversalisItemMarketView } from "../universalis/types.js";

export interface ScoredItem {
  itemId: number;
  currentAveragePrice: number;
  averagePrice: number;
  /** currentAveragePrice / averagePrice - kept for context, not used in ranking. */
  priceRatio: number;
  regularSaleVelocity: number;
  minListingPrice: number | null;
  /** Currently just `regularSaleVelocity` - "hot" means moving a lot, full stop. */
  hotScore: number;
}

export interface ScoringOptions {
  /** Ignore items selling less than this many times/day on average (filters out illiquid noise). Default 1. */
  minVelocity?: number;
}

const DEFAULTS: Required<ScoringOptions> = {
  minVelocity: 1,
};

/**
 * Scores a batch of Universalis market views by sale volume alone - price and
 * profit margin are ignored entirely. "Hot" means moving fast right now, not
 * "priced above its own average" (that was the old definition; dropped per
 * user request in favor of pure volume).
 */
export function scoreItems(
  views: UniversalisItemMarketView[],
  options: ScoringOptions = {},
): ScoredItem[] {
  const opts = { ...DEFAULTS, ...options };

  const candidates = views.filter((v) => v.regularSaleVelocity >= opts.minVelocity);

  const scored: ScoredItem[] = candidates.map((v): ScoredItem => {
    const minListingPrice =
      v.listings.length > 0 ? Math.min(...v.listings.map((l) => l.pricePerUnit)) : null;
    return {
      itemId: v.itemID,
      currentAveragePrice: v.currentAveragePrice,
      averagePrice: v.averagePrice,
      priceRatio: v.averagePrice > 0 ? v.currentAveragePrice / v.averagePrice : 1,
      regularSaleVelocity: v.regularSaleVelocity,
      minListingPrice,
      hotScore: v.regularSaleVelocity,
    };
  });

  return scored.sort((a, b) => b.hotScore - a.hotScore);
}
