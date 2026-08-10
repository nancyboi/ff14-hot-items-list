// Canonical list of DoL/DoH jobs this project understands, shared by the sourcing dataset
// (gatherJobs/craftJobs use these names), the acquirability check, the player-levels config,
// and the web UI's level filter form (so adding a job here is the only change needed to get
// it showing up everywhere).

export interface JobDef {
  name: string;
  abbr: string;
  category: "gather" | "craft";
}

export const GATHER_JOBS: JobDef[] = [
  { name: "Miner", abbr: "MIN", category: "gather" },
  { name: "Botanist", abbr: "BTN", category: "gather" },
  { name: "Fisher", abbr: "FSH", category: "gather" },
];

export const CRAFT_JOBS: JobDef[] = [
  { name: "Carpenter", abbr: "CRP", category: "craft" },
  { name: "Blacksmith", abbr: "BSM", category: "craft" },
  { name: "Armorer", abbr: "ARM", category: "craft" },
  { name: "Goldsmith", abbr: "GSM", category: "craft" },
  { name: "Leatherworker", abbr: "LTW", category: "craft" },
  { name: "Weaver", abbr: "WVR", category: "craft" },
  { name: "Alchemist", abbr: "ALC", category: "craft" },
  { name: "Culinarian", abbr: "CUL", category: "craft" },
];

export const ALL_JOBS: JobDef[] = [...GATHER_JOBS, ...CRAFT_JOBS];

export const JOB_ABBR: Record<string, string> = Object.fromEntries(ALL_JOBS.map((j) => [j.name, j.abbr]));
