/**
 * End-to-end smoke test against any running NairaHome endpoint, using the official MCP TypeScript client.
 *   npm run smoke                                   # http://127.0.0.1:8787/mcp
 *   npm run smoke -- https://nairahome-mcp.vercel.app/mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://127.0.0.1:8787/mcp");
const household = "smoke-" + Math.random().toString(36).slice(2, 12);
const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { "x-nairahome-household": household } } });
const client = new Client({ name: "nairahome-smoke", version: "1.0.0" });
await client.connect(transport);
console.log("connected:", client.getServerVersion(), "protocol", transport.protocolVersion);

const tools = (await client.listTools()).tools;
console.log(`${tools.length} tools:`, tools.map((t) => t.name).join(", "));

const say = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as any;
  console.log(`\n> ${name} ${JSON.stringify(args)}\n  ${r.isError ? "ERROR " : ""}${r.structuredContent?.speech}`);
  return r.structuredContent;
};

const rate = await say("get_naira_rate", { currency: "GBP" });
const mid = rate.data.rate as number;
console.log(`  source: ${rate.data.source} (${rate.data.mode}, as of ${rate.data.asOf})`);
await say("load_sample_family", { confirm: true });
await say("plan_month", { budget: 600 });
const offer = Math.round(mid * 0.985);
await say("check_transfer_quote", { send_amount: 290, offered_rate: offer, fee: 1.99, provider: "ExampleApp" });
await say("log_transfer", { member_name: "Ada", amount_sent: 290, offered_rate: offer, fee: 1.99, provider: "ExampleApp" });
await say("household_summary");
await say("reset_household", { confirm: true });
await client.close();
console.log("\nsmoke OK");
