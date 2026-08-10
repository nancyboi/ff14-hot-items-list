// Your current DoL/DoH job levels, used to gate the hot-items list to what you can actually
// acquire (see src/sourcing/acquirability.ts). Keyed by job name (e.g. "Miner", "Weaver" - the
// same names used in SourcingInfo.gatherJobs/craftJobs). A job absent from PLAYER_LEVELS_JSON
// (or from this map) is treated as level 0 - can't use it at all.
//
// Configure via the PLAYER_LEVELS env var (JSON object), e.g.:
//   PLAYER_LEVELS='{"Miner":50,"Weaver":45,"Botanist":0,"Fisher":0}'
// Falls back to the defaults below if unset.

import type { PlayerLevels } from "../sourcing/acquirability.js";
import { ALL_JOBS } from "../jobs.js";

const LEVEL_OVERRIDES: PlayerLevels = {
  Miner: 50,
  Weaver: 45,
};

// Every known job defaults to 0 (can't use) unless overridden above.
const DEFAULT_PLAYER_LEVELS: PlayerLevels = Object.fromEntries(
  ALL_JOBS.map((job) => [job.name, LEVEL_OVERRIDES[job.name] ?? 0]),
);

export function loadPlayerLevels(): PlayerLevels {
  const raw = process.env.PLAYER_LEVELS;
  if (!raw) return DEFAULT_PLAYER_LEVELS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`PLAYER_LEVELS env var is not valid JSON: ${err}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`PLAYER_LEVELS env var must be a JSON object mapping job name -> level, got: ${raw}`);
  }

  const levels: PlayerLevels = {};
  for (const [job, level] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof level !== "number" || !Number.isFinite(level)) {
      throw new Error(`PLAYER_LEVELS.${job} must be a number, got: ${JSON.stringify(level)}`);
    }
    levels[job] = level;
  }
  return levels;
}
