import type { UniversalisItemMarketView } from "../universalis/types.js";

export interface ScoredItem {
  itemId: number;
  currentAveragePrice: number;
  averagePrice: number;
  /** currentAveragePrice / averagePrice - how elevated current asking prices are vs. the item's own history. */
  priceRatio: number;
  regularSaleVelocity: number;
  /** This item's velocity rank (0-1) among the candidate set fetched this run. */
  velocityPercentile: number;
  minListingPrice: number | null;
  hotScore: number;
}

export interface ScoringOptions {
  /** Ignore items whose historical average sale price is below this (filters out junk). Default 50. */
  minAveragePrice?: number;
  /** Ignore items selling less than this many times/day on average (filters out illiquid noise). Default 1. */
  minVelocity?: number;
  /** Require at least this much of a price premium over the historical average. Default 1.15 (15% up). */
  minPriceRatio?: number;
}

const DEFAULTS: Required<ScoringOptions> = {
  minAveragePrice: 50,
  minVelocity: 1,
  minPriceRatio: 1.15,
};

/**
 * Scores a batch of Universalis market views and returns the ones that look "hot",
 * sorted highest score first. The score rewards items that are both priced above
 * their own historical average AND selling faster than most other candidates in
 * this batch (velocity is ranked relative to the batch, not an absolute scale,
 * since normal sale volume varies wildly by item category).
 */
export function scoreItems(
  views: UniversalisItemMarketView[],
  options: ScoringOptions = {},
): ScoredItem[] {
  const opts = { ...DEFAULTS, ...options };

  const candidates = views.filter(
    (v) => v.averagePrice > 0 && v.currentAveragePrice > 0 && v.regularSaleVelocity >= opts.minVelocity,
  );

  const sortedVelocities = [...candidates].sort((a, b) => a.regularSaleVelocity - b.regularSaleVelocity);
  const velocityRank = new Map<number, number>();
  sortedVelocities.forEach((v, index) => {
    const percentile = sortedVelocities.length > 1 ? index / (sortedVelocities.length - 1) : 1;
    velocityRank.set(v.itemID, percentile);
  });

  const scored: ScoredItem[] = candidates
    .map((v): ScoredItem => {
      const priceRatio = v.currentAveragePrice / v.averagePrice;
      const velocityPercentile = velocityRank.get(v.itemID) ?? 0;
      const minListingPrice =
        v.listings.length > 0 ? Math.min(...v.listings.map((l) => l.pricePerUnit)) : null;
      return {
        itemId: v.itemID,
        currentAveragePrice: v.currentAveragePrice,
        averagePrice: v.averagePrice,
        priceRatio,
        regularSaleVelocity: v.regularSaleVelocity,
        velocityPercentile,
        minListingPrice,
        hotScore: priceRatio * (1 + velocityPercentile),
      };
    })
    .filter((s) => s.averagePrice >= opts.minAveragePrice && s.priceRatio >= opts.minPriceRatio);

  return scored.sort((a, b) => b.hotScore - a.hotScore);
}
