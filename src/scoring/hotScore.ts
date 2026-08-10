import type { UniversalisHistoryEntry, UniversalisItemMarketView } from "../universalis/types.js";

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
  /**
   * Per-item sale velocity (sales/day) to use instead of the market view's own
   * `regularSaleVelocity` - see computeVelocityForWindow, used when the caller wants "hot over
   * the past week/month" rather than Universalis' fixed built-in window.
   */
  velocityOverrides?: Map<number, number>;
}

const DEFAULTS: Required<Pick<ScoringOptions, "minVelocity">> = {
  minVelocity: 1,
};

/**
 * Sums sale quantity from raw history entries within the last `windowDays` days and divides by
 * the window to get a sales/day figure - our own stand-in for Universalis' `regularSaleVelocity`,
 * scoped to a time period the caller actually chose (see src/universalis/client.ts:getSalesHistory
 * for why we don't trust the history endpoint's own velocity field for this).
 */
export function computeVelocityForWindow(entries: UniversalisHistoryEntry[], windowDays: number): number {
  const cutoffSeconds = Date.now() / 1000 - windowDays * 86400;
  const quantityInWindow = entries
    .filter((e) => e.timestamp >= cutoffSeconds)
    .reduce((sum, e) => sum + e.quantity, 0);
  return quantityInWindow / windowDays;
}

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
  const velocityFor = (v: UniversalisItemMarketView) =>
    opts.velocityOverrides?.get(v.itemID) ?? v.regularSaleVelocity;

  const candidates = views.filter((v) => velocityFor(v) >= opts.minVelocity);

  const scored: ScoredItem[] = candidates.map((v): ScoredItem => {
    const minListingPrice =
      v.listings.length > 0 ? Math.min(...v.listings.map((l) => l.pricePerUnit)) : null;
    const velocity = velocityFor(v);
    return {
      itemId: v.itemID,
      currentAveragePrice: v.currentAveragePrice,
      averagePrice: v.averagePrice,
      priceRatio: v.averagePrice > 0 ? v.currentAveragePrice / v.averagePrice : 1,
      regularSaleVelocity: velocity,
      minListingPrice,
      hotScore: velocity,
    };
  });

  return scored.sort((a, b) => b.hotScore - a.hotScore);
}
