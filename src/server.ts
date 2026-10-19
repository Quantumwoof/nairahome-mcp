import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { depsFromEnv, handleHealth, handleMcp } from "./http.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const deps = depsFromEnv();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let response: Response;
    if (url.pathname === "/mcp" || url.pathname === "/api/mcp") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      response = await handleMcp(
        new Request(url, { method: req.method, headers, body: chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined }),
        deps,
      );
    } else if (url.pathname === "/health" || url.pathname === "/api/health") {
      response = handleHealth(deps);
    } else {
      const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
      const file = join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC)) throw Object.assign(new Error("bad path"), { code: "ENOENT" });
      const body = await readFile(file);
      response = new Response(body, { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" } });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    const notFound = (e as NodeJS.ErrnoException).code === "ENOENT";
    res.writeHead(notFound ? 404 : 500, { "content-type": "text/plain" });
    res.end(notFound ? "Not found" : "Server error");
  }
}).listen(port, host, () => {
  console.log(`NairaHome MCP server  http://${host}:${port}/mcp   (store: ${deps.store.kind}, fx: ${process.env.FX_MODE === "demo" ? "DEMO" : "live"})`);
  console.log(`Alexa+ simulator      http://${host}:${port}/`);
});
