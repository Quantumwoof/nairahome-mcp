import { HELP, route } from "./router.js";

const PROTOCOL = "2025-11-25";
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ENDPOINT = params.get("mcp") || new URL("mcp", location.href.replace(/[^/]*$/, "")).href;

// ---------------------------------------------------------------- household id
function newHouseholdId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return "hh-" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
let household = localStorage.getItem("nairahome.household") || newHouseholdId();
localStorage.setItem("nairahome.household", household);

// ---------------------------------------------------------------- minimal MCP client (Streamable HTTP)
let rpcId = 0;
let negotiated = null;
let serverInfo = null;

function logLine(dir, label, body) {
  const li = document.createElement("li");
  const cls = dir === "→" ? "out" : dir === "!" ? "err" : "in";
  li.innerHTML = `<span class="dir ${cls}">${dir}</span><b></b><pre></pre>`;
  li.querySelector("b").textContent = label;
  li.querySelector("pre").textContent = typeof body === "string" ? body : JSON.stringify(body, null, 1);
  const log = $("log");
  log.prepend(li);
  while (log.children.length > 40) log.lastChild.remove();
}

async function readRpc(res) {
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    const text = await res.text();
    const msgs = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
    return msgs.find((m) => "result" in m || "error" in m);
  }
  if (res.status === 202 || res.status === 204) return null;
  return res.json();
}

async function rpc(method, params, { notify = false } = {}) {
  const msg = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params };
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "x-nairahome-household": household };
  if (negotiated) headers["mcp-protocol-version"] = negotiated;
  logLine("→", method, params ?? {});
  const init = { method: "POST", headers, body: JSON.stringify(msg) };
  let res;
  try {
    res = await fetch(ENDPOINT, init);
  } catch (e) {
    // One retry on a dropped connection (e.g. cold start), but only for calls that are safe to repeat.
    const mutating = method === "tools/call" && /^(log_transfer|add_|remove_|reset_|set_)/.test(params?.name ?? "");
    if (mutating) throw e;
    logLine("!", `${method} network error, retrying once`, String(e.message || e));
    await new Promise((r) => setTimeout(r, 600));
    res = await fetch(ENDPOINT, init);
  }
  if (notify) return null;
  const body = await readRpc(res);
  if (!body) throw new Error(`HTTP ${res.status}`);
  if (body.error) {
    logLine("!", `${method} error`, body.error);
    throw new Error(body.error.message);
  }
  logLine("←", method, summarise(method, body.result));
  return body.result;
}

function summarise(method, result) {
  if (method === "tools/list") return result.tools.map((t) => t.name).join(", ");
  if (method === "resources/read") return result.contents.map((c) => `${c.uri} (${c.mimeType}, ${c.text.length} chars)`).join("\n");
  if (method === "tools/call") return { isError: !!result.isError, structuredContent: result.structuredContent };
  return result;
}

let initPromise = null;
async function ensureInit() {
  initPromise ??= (async () => {
    const r = await rpc("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
      clientInfo: { name: "nairahome-alexa-simulator", version: "1.0.0" },
    });
    negotiated = r.protocolVersion;
    serverInfo = r.serverInfo;
    await rpc("notifications/initialized", undefined, { notify: true });
    const { tools } = await rpc("tools/list", {});
    const card = await rpc("resources/read", { uri: "ui://nairahome/card.html" });
    setupCard(card.contents[0].text);
    renderMeta(tools);
    setStatus("ok", `Connected · MCP ${negotiated} · ${serverInfo.name} ${serverInfo.version}`);
    return tools;
  })().catch((e) => {
    initPromise = null;
    setStatus("err", "MCP server unreachable: " + e.message);
    throw e;
  });
  return initPromise;
}

async function callTool(name, args) {
  await ensureInit();
  return rpc("tools/call", { name, arguments: args });
}

// ---------------------------------------------------------------- MCP App host for the card
let cardReady = false;
let cardQueue = null;
function setupCard(html) {
  const frame = $("card");
  cardReady = false;
  frame.srcdoc = html;
}
window.addEventListener("message", (ev) => {
  if (ev.source !== $("card").contentWindow) return;
  const m = ev.data;
  if (!m || m.jsonrpc !== "2.0") return;
  if (m.method === "ui/initialize" && m.id !== undefined) {
    ev.source.postMessage(
      {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          protocolVersion: "2026-01-26",
          hostInfo: { name: "nairahome-alexa-simulator", version: "1.0.0" },
          hostCapabilities: {},
          hostContext: { theme: "dark", displayMode: "inline", platform: "web" },
        },
      },
      "*",
    );
  } else if (m.method === "ui/notifications/initialized") {
    cardReady = true;
    if (cardQueue) pushCard(cardQueue);
  }
});
function pushCard(result) {
  if (!result?.structuredContent || result.structuredContent.kind === "error") return;
  if (!cardReady) {
    cardQueue = result;
    return;
  }
  cardQueue = null;
  $("card").contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result }, "*");
  document.querySelector(".screen").classList.add("has-card");
}

// ---------------------------------------------------------------- conversation
const ctx = { members: [], pending: null, lastQuote: null };

async function refreshMembers() {
  try {
    const r = await callTool("household_summary", {});
    ctx.members = (r.structuredContent?.data?.members || []).map((m) => m.name);
  } catch {
    /* status shows the error */
  }
}

function ring(state) {
  $("ring").className = "ring " + (state || "");
}

function say(text, you) {
  $("speech").innerHTML = (you ? `<span class="you"></span>` : "") + `<span class="alexa"></span>`;
  if (you) $("speech").querySelector(".you").textContent = "You: " + you;
  $("speech").querySelector(".alexa").textContent = text;
  if (!$("speak").checked || !("speechSynthesis" in window)) return ring("");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/₦/g, " naira ").replace(/£(\d)/g, "$1 pounds ").replace(/\$(\d)/g, "$1 dollars ").replace(/€(\d)/g, "$1 euros "));
  const v = speechSynthesis.getVoices();
  u.voice = v.find((x) => /en-NG/i.test(x.lang)) || v.find((x) => /en-GB/i.test(x.lang)) || v.find((x) => /^en/i.test(x.lang)) || null;
  u.rate = 1.03;
  u.onstart = () => ring("speak");
  u.onend = () => ring("");
  speechSynthesis.speak(u);
}

async function handle(utterance) {
  utterance = utterance.trim();
  if (!utterance) return;
  ring("think");
  const decision = route(utterance, { ...ctx, today: new Date() });
  ctx.pending = decision.pending || null;
  if (decision.say || decision.ask) return say(decision.say || decision.ask, utterance);
  try {
    const result = await callTool(decision.tool, decision.args);
    const sc = result.structuredContent || {};
    if (decision.tool === "check_transfer_quote" && !result.isError) ctx.lastQuote = decision.args;
    if (decision.tool === "log_transfer" && !result.isError) ctx.lastQuote = null;
    if (["load_sample_family", "add_family_member", "reset_household"].includes(decision.tool)) await refreshMembers();
    if (decision.tool === "household_summary") ctx.members = (sc.data?.members || []).map((m) => m.name);
    pushCard(result);
    let line = sc.speech || result.content?.[0]?.text || "Done.";
    if (decision.tool === "check_transfer_quote" && !result.isError) line += " Say 'I've sent it to' and a name once you've sent it, and I'll log it.";
    say(line, utterance);
  } catch (e) {
    say("Sorry, I couldn't reach the NairaHome server. " + e.message, utterance);
  }
}

// ---------------------------------------------------------------- voice input (Web Speech API, where available)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  $("mic").disabled = true;
  $("mic").title = "Voice input needs Chrome or Edge. Type instead.";
} else {
  const rec = new SR();
  rec.lang = "en-GB";
  rec.interimResults = true;
  let listening = false;
  rec.onresult = (e) => {
    const text = [...e.results].map((r) => r[0].transcript).join(" ");
    $("utter").value = text;
    if (e.results[e.results.length - 1].isFinal) {
      $("utter").value = "";
      handle(text);
    }
  };
  rec.onend = () => {
    listening = false;
    $("mic").classList.remove("on");
    if ($("ring").className.includes("listen")) ring("");
  };
  rec.onerror = (e) => say("Mic error: " + e.error + ". You can type instead.");
  $("mic").onclick = () => {
    if (listening) return rec.stop();
    speechSynthesis?.cancel();
    listening = true;
    $("mic").classList.add("on");
    ring("listen");
    rec.start();
  };
}

// ---------------------------------------------------------------- UI wiring
// Example utterances. Offer rates in them are EXAMPLES of what a user might read off their app,
// placed just under today's live mid-market rate so they stay realistic; they are never shown as results.
function renderChips(mid) {
  const r = (f, step = 5) => Math.round((mid * f) / step) * step;
  // Enough to cover the sample family's ₦490,000 for Ada at the example offer below.
  const ada = Math.ceil(490_000 / r(0.985) / 5) * 5;
  const chips = mid
    ? [
        "Load the sample family",
        "Plan my month with 600 pounds",
        "What's the pound to naira rate?",
        `I'm sending ${ada} pounds to Ada at ${r(0.985)} with a £1.99 fee on Lemfi`,
        "I've sent it to Ada",
        `Compare Wise at ${r(0.995)} fee 3.40 and Lemfi at ${r(0.982)} no fee for ${ada} pounds`,
        `Tell me when the pound hits ${r(1.02, 10)} naira`,
        "Household summary",
      ]
    : ["Load the sample family", "Plan my month with 600 pounds", "What's the pound to naira rate?", "Household summary", "Help"];
  $("chips").replaceChildren(
    ...chips.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c;
      b.onclick = () => handle(c);
      return b;
    }),
  );
}
renderChips(null);
$("ask").onsubmit = (e) => {
  e.preventDefault();
  const v = $("utter").value;
  $("utter").value = "";
  handle(v);
};
$("hhid").textContent = household;
$("endpoint").textContent = ENDPOINT;
$("newhh").onclick = async () => {
  household = newHouseholdId();
  localStorage.setItem("nairahome.household", household);
  $("hhid").textContent = household;
  ctx.members = [];
  ctx.lastQuote = null;
  document.querySelector(".screen").classList.remove("has-card");
  say("New, empty household. Say 'load the sample family' or add someone you support.");
};
async function submitForm(form, tool, coerce) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const k of Object.keys(data)) if (data[k] === "") delete data[k];
  const r = await callTool(tool, coerce(data));
  say(r.structuredContent?.speech || "Saved.");
  if (!r.isError) form.reset();
  await refreshMembers();
}
$("addMember").onsubmit = (e) => {
  e.preventDefault();
  submitForm(e.target, "add_family_member", (d) => d);
};
$("addObligation").onsubmit = (e) => {
  e.preventDefault();
  submitForm(e.target, "add_obligation", (d) => ({ ...d, amount_ngn: Number(d.amount_ngn), category: "other" }));
};

function setStatus(kind, text) {
  $("status").className = "status " + kind;
  $("status").querySelector("span").textContent = text;
}
function renderMeta(tools) {
  $("meta").innerHTML = `Endpoint <b></b><br>Protocol <b>${negotiated}</b> · transport <b>Streamable HTTP</b> · ${tools.length} tools · MCP App card`;
  $("meta").querySelector("b").textContent = ENDPOINT;
}

ensureInit()
  .then(async () => {
    await refreshMembers();
    try {
      const r = await callTool("get_naira_rate", { currency: "GBP" });
      if (!r.isError) renderChips(r.structuredContent.data.rate);
    } catch {
      /* chips stay generic */
    }
  })
  .catch(() => {});
say("Hi! I'm NairaHome. " + HELP.split(";")[0].replace("You can say:", "Try:") + ".");
