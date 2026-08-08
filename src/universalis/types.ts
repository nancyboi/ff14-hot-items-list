export interface UniversalisListing {
  pricePerUnit: number;
  quantity: number;
  hq: boolean;
  worldName?: string;
  retainerName: string;
  lastReviewTime: number;
}

export interface UniversalisSale {
  pricePerUnit: number;
  quantity: number;
  hq: boolean;
  timestamp: number;
  worldName?: string;
}

// Shape of one item's entry from GET /api/v2/{world}/{itemIds}.
// Field names/availability come from the Universalis docs (docs.universalis.app) as of
// last review; this project's sandbox can't reach that host to re-verify live, so double
// check field names against a real response before relying on anything not used below.
export interface UniversalisItemMarketView {
  itemID: number;
  lastUploadTime: number;
  listings: UniversalisListing[];
  recentHistory: UniversalisSale[];
  currentAveragePrice: number;
  currentAveragePriceNQ: number;
  currentAveragePriceHQ: number;
  regularSaleVelocity: number;
  nqSaleVelocity: number;
  hqSaleVelocity: number;
  averagePrice: number;
  averagePriceNQ: number;
  averagePriceHQ: number;
  minPrice?: number;
  minPriceNQ?: number;
  minPriceHQ?: number;
}

export interface MostRecentlyUpdatedEntry {
  itemID: number;
  lastUploadTime: number;
}
