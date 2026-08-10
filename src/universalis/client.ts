import type {
  MostRecentlyUpdatedEntry,
  UniversalisItemMarketView,
  UniversalisSalesHistory,
} from "./types.js";

const BASE_URL = "https://universalis.app/api/v2";

// Universalis batches up to 100 item IDs per request. Keep a small delay between
// batches to be a polite API citizen; tune this once real rate-limit behavior has
// been observed (this sandbox can't reach universalis.app to check).
const MAX_IDS_PER_REQUEST = 100;
const DELAY_BETWEEN_BATCHES_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      return (await res.json()) as T;
    }
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= MAX_RETRIES) {
      throw new Error(`Universalis request failed (${res.status} ${res.statusText}): ${url}`);
    }
    await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
  }
}

/** All marketable item IDs, tradeable on the market board. */
export async function getMarketableItemIds(): Promise<number[]> {
  return getJson<number[]>(`${BASE_URL}/marketable`);
}

/**
 * Item IDs with the most recently uploaded market data on a world/DC/region.
 * Used as a cheap pre-filter so we don't have to pull full stats for every
 * marketable item (~5-6k) on every run - only ones with fresh activity.
 */
export async function getMostRecentlyUpdatedItemIds(
  world: string,
  entries = 200,
): Promise<number[]> {
  const url = `${BASE_URL}/extra/stats/most-recently-updated?world=${encodeURIComponent(world)}&entries=${entries}`;
  const data = await getJson<{ items: MostRecentlyUpdatedEntry[] } | MostRecentlyUpdatedEntry[]>(url);
  const items = Array.isArray(data) ? data : data.items;
  return items.map((entry) => entry.itemID);
}

const FIELD_NAMES = [
  "itemID",
  "lastUploadTime",
  "currentAveragePrice",
  "currentAveragePriceNQ",
  "currentAveragePriceHQ",
  "averagePrice",
  "averagePriceNQ",
  "averagePriceHQ",
  "regularSaleVelocity",
  "nqSaleVelocity",
  "hqSaleVelocity",
  "listings.pricePerUnit",
  "listings.hq",
  "listings.worldName",
];

// Universalis namespaces multi-item batch responses under `items`, and the
// `fields` filter must mirror that with an `items.` prefix - omitting it
// silently returns `{}` for every batch. Single-item requests return an
// unwrapped object and must NOT have the prefix.
const FIELDS = FIELD_NAMES.join(",");
const FIELDS_BATCH = FIELD_NAMES.map((f) => `items.${f}`).join(",");

/**
 * Fetches market stats for a batch of item IDs on a single world. Handles
 * Universalis' quirk where a single-item request returns a bare object instead
 * of the `{ items: { ... } }` wrapper used for multi-item requests.
 */
async function getMarketDataBatch(
  world: string,
  itemIds: number[],
): Promise<UniversalisItemMarketView[]> {
  if (itemIds.length === 0) return [];
  const fields = itemIds.length === 1 ? FIELDS : FIELDS_BATCH;
  const url = `${BASE_URL}/${encodeURIComponent(world)}/${itemIds.join(",")}?fields=${encodeURIComponent(fields)}`;
  const data = await getJson<
    UniversalisItemMarketView | { items: Record<string, UniversalisItemMarketView> }
  >(url);

  if (itemIds.length === 1) {
    return [data as UniversalisItemMarketView];
  }
  const wrapped = data as { items: Record<string, UniversalisItemMarketView> };
  return Object.values(wrapped.items ?? {});
}

export interface GetMarketDataOptions {
  onProgress?: (done: number, total: number) => void;
}

/** Fetches market stats for many item IDs on one world, batching and rate-limiting requests. */
export async function getMarketData(
  world: string,
  itemIds: number[],
  options: GetMarketDataOptions = {},
): Promise<Map<number, UniversalisItemMarketView>> {
  const batches = chunk(itemIds, MAX_IDS_PER_REQUEST);
  const results = new Map<number, UniversalisItemMarketView>();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const views = await getMarketDataBatch(world, batch);
    for (const view of views) {
      results.set(view.itemID, view);
    }
    options.onProgress?.(results.size, itemIds.length);
    if (i < batches.length - 1) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  return results;
}

// Universalis's own storage retention for raw sale entries is a lot shorter than most of our
// "past month" style windows, so ask for as many as it'll give us and let the caller filter by
// timestamp for whatever window it actually wants (see computeVelocityForWindow in hotScore.ts).
const MAX_HISTORY_ENTRIES = 999;

async function getSalesHistoryBatch(world: string, itemIds: number[]): Promise<UniversalisSalesHistory[]> {
  if (itemIds.length === 0) return [];
  const url = `${BASE_URL}/history/${encodeURIComponent(world)}/${itemIds.join(",")}?entriesToReturn=${MAX_HISTORY_ENTRIES}`;
  const data = await getJson<UniversalisSalesHistory | { items: Record<string, UniversalisSalesHistory> }>(url);

  if (itemIds.length === 1) {
    return [data as UniversalisSalesHistory];
  }
  const wrapped = data as { items: Record<string, UniversalisSalesHistory> };
  return Object.values(wrapped.items ?? {});
}

/** Fetches raw sale history for many item IDs on one world, batching and rate-limiting requests. */
export async function getSalesHistory(
  world: string,
  itemIds: number[],
  options: GetMarketDataOptions = {},
): Promise<Map<number, UniversalisSalesHistory>> {
  const batches = chunk(itemIds, MAX_IDS_PER_REQUEST);
  const results = new Map<number, UniversalisSalesHistory>();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const views = await getSalesHistoryBatch(world, batch);
    for (const view of views) {
      results.set(view.itemID, view);
    }
    options.onProgress?.(results.size, itemIds.length);
    if (i < batches.length - 1) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  return results;
}
