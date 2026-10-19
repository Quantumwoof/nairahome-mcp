import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { DemoFx, LiveFx } from "../src/core/fx.js";
import { MemoryStore } from "../src/core/store.js";
import { handleMcp, type AppDeps } from "../src/http.js";

const NOW = new Date("2026-10-19T09:00:00Z");

async function connect(deps: AppDeps, household = "test-household-1") {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    req.headers.set("x-nairahome-household", household);
    return handleMcp(new Request(req, { headers: req.headers }), deps);
  }) as typeof fetch;
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://local.test/mcp"), { fetch: fetchImpl }));
  return client;
}

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return r as unknown as { isError?: boolean; structuredContent: { speech: string; kind: string; data: any } };
};

test("negotiates MCP 2025-11-25 over Streamable HTTP and lists tools, resources, prompts", async () => {
  const deps: AppDeps = { store: new MemoryStore(), fx: new DemoFx(), now: () => NOW };
  const c = await connect(deps);
  assert.equal(LATEST_PROTOCOL_VERSION, "2025-11-25");
  assert.equal(c.getServerVersion()?.name, "nairahome");
  const tools = (await c.listTools()).tools.map((t) => t.name).sort();
  for (const t of ["get_naira_rate", "check_transfer_quote", "compare_quotes", "plan_month", "log_transfer", "household_summary", "set_rate_alert"]) {
    assert.ok(tools.includes(t), t);
  }
  const plan = (await c.listTools()).tools.find((t) => t.name === "plan_month")!;
  assert.equal((plan._meta as any).ui.resourceUri, "ui://nairahome/card.html");
  assert.equal(plan.annotations?.readOnlyHint, true);
  const res = await c.readResource({ uri: "ui://nairahome/card.html" });
  assert.equal(res.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok((await c.listPrompts()).prompts.some((p) => p.name === "monthly_check_in"));
});

test("full household flow persists across separate MCP sessions", async () => {
  const deps: AppDeps = { store: new MemoryStore(), fx: new DemoFx(), now: () => NOW };
  let c = await connect(deps);
  assert.equal((await call(c, "load_sample_family", { confirm: true })).structuredContent.kind, "household");
  await c.close();

  // New session, same household: memory survives.
  c = await connect(deps);
  const plan = await call(c, "plan_month", { budget: 340 });
  assert.equal(plan.structuredContent.kind, "plan");
  assert.equal(plan.structuredContent.data.fx.mode, "demo");
  assert.match(plan.structuredContent.speech, /Demo mode rate/);
  assert.ok(plan.structuredContent.data.plan.items.length >= 4);

  const logged = await call(c, "log_transfer", { member_name: "Mum", amount_sent: 80, offered_rate: 1960, fee: 1.5, provider: "TestPay" });
  assert.match(logged.structuredContent.speech, /monthly upkeep/);
  assert.equal(logged.structuredContent.data.covered[0].nextDue, "2026-11-25");

  const summary = await call(c, "household_summary");
  assert.equal(summary.structuredContent.data.thisMonth.count, 1);
  assert.ok(summary.structuredContent.data.learnedCostPct > 0);

  // A different household sees nothing.
  const other = await connect(deps, "someone-else-22");
  const empty = await call(other, "plan_month");
  assert.equal(empty.structuredContent.data.empty, true);
});

test("quote sanity check rejects a rate in the wrong currency", async () => {
  const c = await connect({ store: new MemoryStore(), fx: new DemoFx(), now: () => NOW });
  const bad = await call(c, "check_transfer_quote", { send_amount: 100, offered_rate: 1500, currency: "GBP", fee: 0 });
  assert.equal(bad.isError, true);
  const good = await call(c, "check_transfer_quote", { send_amount: 100, offered_rate: 1960, currency: "GBP", fee: 0, provider: "X" });
  assert.equal(good.structuredContent.data.quote.verdict, "within_un_target");
});

test("rate alerts are remembered and reported by the planner", async () => {
  const deps: AppDeps = { store: new MemoryStore(), fx: new DemoFx(), now: () => NOW };
  let c = await connect(deps);
  await call(c, "load_sample_family", { confirm: true });
  const set = await call(c, "set_rate_alert", { target_rate: 1990 });
  assert.match(set.structuredContent.speech, /already/); // demo GBP is 2000
  // a pending alert above the market
  const pending = await call(c, "set_rate_alert", { target_rate: 2100 });
  assert.match(pending.structuredContent.speech, /I'll flag it/);
  const check = await call(c, "check_rate_alerts");
  assert.match(check.structuredContent.speech, /still below/);
});

test("refuses account numbers", async () => {
  const c = await connect({ store: new MemoryStore(), fx: new DemoFx(), now: () => NOW });
  const r = await call(c, "add_family_member", { name: "Tunde", relationship: "brother", payout_note: "0123456789" });
  assert.equal(r.isError, true);
});

test("live FX is honest when the rate API is down", async () => {
  const downFetch = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  const c = await connect({ store: new MemoryStore(), fx: new LiveFx(downFetch), now: () => NOW });
  const r = await call(c, "get_naira_rate", { currency: "USD" });
  assert.equal(r.isError, true);
  assert.match(r.structuredContent.speech, /won't guess a rate/);
});

test("bearer token is enforced when configured", async () => {
  const deps: AppDeps = { store: new MemoryStore(), fx: new DemoFx(), token: "s3cret" };
  const res = await handleMcp(new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), deps);
  assert.equal(res.status, 401);
});
