import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { fxFromEnv, type FxProvider } from "./core/fx.js";
import { HOUSEHOLD_ID, storeFromEnv, type HouseholdStore } from "./core/store.js";
import { SERVER_VERSION, createNairaHomeServer } from "./mcp/server.js";

export const DEFAULT_HOUSEHOLD = "public-demo-household";

export interface AppDeps {
  store: HouseholdStore;
  fx: FxProvider;
  token?: string;
  allowedOrigins?: string[];
  now?: () => Date;
}

let singleton: AppDeps | null = null;
export function depsFromEnv(env = process.env): AppDeps {
  singleton ??= {
    store: storeFromEnv(env),
    fx: fxFromEnv(env),
    token: env.NAIRAHOME_TOKEN || undefined,
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : undefined,
  };
  return singleton;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id, x-nairahome-household",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return withCors(new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json", ...extra } }));
}

function rpcError(status: number, code: number, message: string): Response {
  return json(status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

export function householdFrom(req: Request): string {
  const url = new URL(req.url);
  const id = req.headers.get("x-nairahome-household") ?? url.searchParams.get("household") ?? DEFAULT_HOUSEHOLD;
  if (!HOUSEHOLD_ID.test(id)) throw new Error("bad household id");
  return id;
}

/** MCP endpoint: stateless Streamable HTTP (one server + transport per request, JSON responses). */
export async function handleMcp(req: Request, deps: AppDeps = depsFromEnv()): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
  const origin = req.headers.get("origin");
  if (deps.allowedOrigins && origin && !deps.allowedOrigins.includes(origin)) return rpcError(403, -32000, "Origin not allowed");
  if (deps.token && req.headers.get("authorization") !== `Bearer ${deps.token}`) {
    return withCors(
      new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="nairahome"' },
      }),
    );
  }
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    return withCors(new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } }));
  }
  let householdId: string;
  try {
    householdId = householdFrom(req);
  } catch {
    return rpcError(400, -32602, "x-nairahome-household must be 8-64 letters, digits, '-' or '_'");
  }
  const server = createNairaHomeServer({ store: deps.store, fx: deps.fx, householdId, now: deps.now });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    void transport.close();
    void server.close();
  }
}

export function handleHealth(deps: AppDeps = depsFromEnv()): Response {
  return json(200, {
    ok: true,
    name: "nairahome",
    version: SERVER_VERSION,
    mcpEndpoint: "/mcp",
    transport: "streamable-http (stateless, JSON responses)",
    protocolVersion: LATEST_PROTOCOL_VERSION,
    store: { kind: deps.store.kind, durable: deps.store.durable },
    fx: deps.fx.constructor.name === "DemoFx" ? "demo" : "live",
    auth: deps.token ? "bearer" : "none (household id header)",
  });
}
