import Anthropic from "@anthropic-ai/sdk";
import type { HotListEntry } from "../generate.js";

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Asks Claude to turn the ranked, structured hot-item data into a short,
 * plain-English blurb per item (why it's hot + how easy it is to get).
 * This is a thin summarization step over numbers we've already computed -
 * the ranking and effort tiers themselves are deterministic, not AI-guessed.
 */
export async function generateBlurbs(items: HotListEntry[]): Promise<Map<number, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set - required for --ai-blurbs.");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const itemSummaries = items.map((item) => ({
    itemId: item.itemId,
    name: item.name,
    currentAveragePrice: Math.round(item.currentAveragePrice),
    averagePrice: Math.round(item.averagePrice),
    priceRatioPercent: Math.round(item.priceRatio * 100),
    salesPerDay: Math.round(item.regularSaleVelocity * 10) / 10,
    effortTier: item.effortTier,
    gatherable: item.gatherable,
    vendor: item.vendor,
    craftable: item.craftable,
    craftJobs: item.craftJobs,
  }));

  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are annotating a ranked list of FFXIV market board items that are currently selling for more than usual and moving faster than usual. For each item below, write ONE short sentence (under 20 words) explaining why it looks "hot" and how easy it would be for a player to supply it, using effortTier (0 = gather/vendor, 1 = simple one-step craft, 2+ = nested/multi-step craft, null = source unknown, likely a drop).

Respond with ONLY a JSON object mapping itemId (as a string) to the blurb string. No other text.

Items:
${JSON.stringify(itemSummaries, null, 2)}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response contained no text content.");
  }

  const parsed = JSON.parse(textBlock.text) as Record<string, string>;
  const blurbs = new Map<number, string>();
  for (const [itemId, blurb] of Object.entries(parsed)) {
    blurbs.set(Number(itemId), blurb);
  }
  return blurbs;
}
