// Minimal static file server for the dashboard - no dependencies.
// Serves ./public at "/" and ./data at "/data" (so the page can fetch
// /data/hot-items.json after `npm run generate`).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function resolveSafe(baseDir, urlPath) {
  const resolved = normalize(join(baseDir, urlPath));
  if (!resolved.startsWith(baseDir)) return null; // guard against ../ traversal
  return resolved;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
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
