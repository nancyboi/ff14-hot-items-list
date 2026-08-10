// Dev server: serves the static dashboard (./public at "/", ./data at "/data"), and a
// POST /api/search endpoint that runs the same generateHotItems() pipeline as `npm run
// generate` on demand, so the web UI's filter form (job levels, time window, world) can
// re-query without a page reload or a separate CLI invocation.
import { createServer, type IncomingMessage } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { generateHotItems, type GenerateOptions } from "./generate.js";
import { ALL_JOBS } from "./jobs.js";
import { ALL_TAGS, TAG_IDS } from "./tags.js";
import type { PlayerLevels } from "./sourcing/acquirability.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const OUTPUT_PATH = join(DATA_DIR, "hot-items.json");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function resolveSafe(baseDir: string, urlPath: string): string | null {
  const resolved = normalize(join(baseDir, urlPath));
  if (!resolved.startsWith(baseDir)) return null; // guard against ../ traversal
  return resolved;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseSearchBody(raw: string): GenerateOptions {
  let body: Record<string, unknown>;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("Request body must be valid JSON.");
  }

  const world = typeof body.world === "string" && body.world.trim() ? body.world.trim() : "Siren";
  const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : 25;
  const candidates = Number.isFinite(Number(body.candidates)) ? Number(body.candidates) : 200;
  const days = Number.isFinite(Number(body.days)) ? Number(body.days) : 7;
  const myLevelsOnly = body.myLevelsOnly !== false;

  let playerLevels: PlayerLevels | undefined;
  if (body.playerLevels && typeof body.playerLevels === "object") {
    playerLevels = {};
    for (const job of ALL_JOBS) {
      const raw = (body.playerLevels as Record<string, unknown>)[job.name];
      const level = Number(raw);
      playerLevels[job.name] = Number.isFinite(level) ? level : 0;
    }
  }

  const includeTags = Array.isArray(body.includeTags)
    ? body.includeTags.filter((t): t is string => typeof t === "string" && TAG_IDS.has(t))
    : [];
  const excludeTags = Array.isArray(body.excludeTags)
    ? body.excludeTags.filter((t): t is string => typeof t === "string" && TAG_IDS.has(t))
    : [];

  return { world, limit, candidates, days, aiBlurbs: false, myLevelsOnly, playerLevels, includeTags, excludeTags };
}

async function handleSearch(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
  const raw = await readBody(req);
  let options: GenerateOptions;
  try {
    options = parseSearchBody(raw);
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } };
  }

  try {
    const output = await generateHotItems(options);
    // Keep data/hot-items.json in sync so a plain page refresh shows the last search too.
    await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
    return { status: 200, body: output };
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/jobs" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(ALL_JOBS));
    return;
  }

  if (url.pathname === "/api/tags" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(ALL_TAGS));
    return;
  }

  if (url.pathname === "/api/search" && req.method === "POST") {
    const { status, body } = await handleSearch(req);
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    return;
  }

  let baseDir = PUBLIC_DIR;
  let path = url.pathname;

  if (path.startsWith("/data/")) {
    baseDir = DATA_DIR;
    path = path.slice("/data".length);
  } else if (path === "/") {
    path = "/index.html";
  }

  const filePath = resolveSafe(baseDir, path);
  if (!filePath) {
    res.writeHead(400).end("Bad request");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
