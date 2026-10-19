// NairaHome simulated-Alexa+ intent router.
// This stands in for Alexa+'s language model in the web simulator ONLY: it maps an utterance to one
// NairaHome MCP tool call (or asks a follow-up question). It is deliberately small, readable rules.
// Every number the user hears still comes from the real MCP server.

const CUR_WORDS = [
  [/\b(canadian dollars?|cad|c\$)/, "CAD"],
  [/(£|\bpounds?\b|\bquid\b|\bgbp\b|\bsterling\b)/, "GBP"],
  [/(€|\beuros?\b|\beur\b)/, "EUR"],
  [/(\$|\bdollars?\b|\busd\b|\bbucks\b)/, "USD"],
];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function normalise(text) {
  return String(text)
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/(\d+(?:\.\d+)?)\s*(k|thousand)\b/gi, (_, n) => String(Number(n) * 1000))
    .replace(/(\d+(?:\.\d+)?)\s*(m|million)\b/gi, (_, n) => String(Number(n) * 1_000_000))
    .replace(/\btwo thousand\b/gi, "2000")
    .replace(/\bone thousand\b/gi, "1000")
    .trim();
}

export function detectCurrency(t) {
  const l = t.toLowerCase();
  for (const [re, c] of CUR_WORDS) if (re.test(l)) return c;
  return undefined;
}

const NUM = "(\\d+(?:\\.\\d+)?)";

/** Pull amount, rate, fee, provider out of a sentence like "sending £300 at 1960 with a £2 fee on Lemfi". */
export function parseMoney(raw) {
  const t = normalise(raw);
  const l = t.toLowerCase();
  const out = {};
  const cur = detectCurrency(t);
  if (cur) out.currency = cur;

  let m =
    l.match(new RegExp(`(?:fee|fees|charge)\\s*(?:is|of|:)?\\s*(?:[£$€]|c\\$)?\\s*${NUM}`)) ||
    l.match(new RegExp(`(?:[£$€]|c\\$)?\\s*${NUM}\\s*(?:pounds?|dollars?|euros?|gbp|usd|eur|cad)?\\s*(?:fee|fees|charge)`));
  if (m) out.fee = Number(m[1]);
  else if (/\b(no fee|zero fee|free|without (a )?fee)\b/.test(l)) out.fee = 0;

  m = l.match(new RegExp(`(?:\\bat\\b|rate (?:is|of)?|offering|gives?|giving)\\s*(?:₦|ngn)?\\s*${NUM}`)) ||
    l.match(new RegExp(`${NUM}\\s*(?:naira|ngn)\\s*(?:per|to the|a|for (?:one|1|a|each))`));
  if (m) out.offered_rate = Number(m[1]);

  // Sender amount: the first "£300" / "300 pounds" that isn't the fee.
  const cands = [];
  for (const re of [
    new RegExp(`(?:[£$€]|c\\$)\\s*${NUM}(?!\\d|\\.\\d)(?!\\s*(?:pounds?|dollars?|euros?|gbp|usd|eur|cad)?\\s*(?:fee|fees|charge))`, "g"),
    new RegExp(`(?<!\\d|\\d\\.)${NUM}\\s*(?:canadian dollars?|pounds?|quid|dollars?|bucks|euros?|gbp|usd|eur|cad)\\b(?!\\s*(?:fee|fees|charge))`, "g"),
  ]) {
    for (const x of l.matchAll(re)) {
      const before = l.slice(Math.max(0, x.index - 12), x.index);
      if (/(fee|fees|charge)\s*(is|of|:)?\s*$/.test(before)) continue;
      cands.push({ at: x.index, n: Number(x[1]) });
    }
  }
  cands.sort((a, b) => a.at - b.at);
  if (cands.length) out.send_amount = cands[0].n;

  // A bare number that's plainly a naira rate (e.g. "1960") when nothing else claimed it.
  if (out.offered_rate === undefined) {
    const nums = [...l.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
    const r = nums.find((n) => n >= 500 && n <= 5000 && n !== out.send_amount);
    if (r !== undefined && (out.send_amount !== undefined || /\brate\b|naira/.test(l))) out.offered_rate = r;
  }

  m = t.match(/\b(?:on|with|via|using|through)\s+([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*)?)/);
  if (m && !/^(a|the|fee|no)$/i.test(m[1])) out.provider = m[1].trim();
  return out;
}

export function parseDate(text, today = new Date()) {
  const l = text.toLowerCase();
  let m = l.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const y = today.getUTCFullYear();
  const mk = (yr, mo, d) => {
    let date = new Date(Date.UTC(yr, mo, d));
    if (date < new Date(Date.UTC(y, today.getUTCMonth(), today.getUTCDate()))) date = new Date(Date.UTC(yr + 1, mo, d));
    return date.toISOString().slice(0, 10);
  };
  const monthRe = MONTHS.map((x) => x.slice(0, 3) + "[a-z]*").join("|");
  m = l.match(new RegExp(`(${monthRe})\\s+(\\d{1,2})(?:st|nd|rd|th)?`));
  if (m) return mk(y, MONTHS.findIndex((x) => m[1].startsWith(x.slice(0, 3))), Number(m[2]));
  m = l.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthRe})`));
  if (m) return mk(y, MONTHS.findIndex((x) => m[2].startsWith(x.slice(0, 3))), Number(m[1]));
  if (/next month/.test(l)) return new Date(Date.UTC(y, today.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  m = l.match(/(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = d >= today.getUTCDate() ? today.getUTCMonth() : today.getUTCMonth() + 1;
    return new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);
  }
  return undefined;
}

function findMember(text, members) {
  const l = text.toLowerCase();
  const synonyms = { mum: ["mom", "mother", "mama", "mummy"], dad: ["father", "papa", "daddy"] };
  for (const name of members) {
    const n = name.toLowerCase();
    const alts = [n, ...(synonyms[n] || [])];
    if (alts.some((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l))) return name;
  }
  return undefined;
}

export const HELP =
  "You can say: plan my month with 600 pounds; what's the pound to naira; I'm sending 300 pounds to Mum, then tell me your app's rate and fee; " +
  "compare two apps' rates; I've sent it to Mum; tell me when the pound hits a target rate; or load the sample family.";

/**
 * @param {string} utterance
 * @param {{members?: string[], currency?: string, pending?: any, lastQuote?: any, today?: Date}} ctx
 * @returns {{tool?: string, args?: object, ask?: string, say?: string, pending?: any, confirm?: string}}
 */
export function route(utterance, ctx = {}) {
  const raw = String(utterance || "").replace(/^\s*(hey\s+)?alexa[,\s]*/i, "").trim();
  const t = normalise(raw);
  const l = t.toLowerCase();
  const members = ctx.members || [];
  const today = ctx.today || new Date();
  if (!l) return { say: HELP };

  // Pending confirmation for destructive actions
  if (ctx.pending?.confirm) {
    if (/^(yes|yeah|yep|sure|confirm|do it|ok(ay)?)\b/.test(l)) return { tool: ctx.pending.confirm, args: { confirm: true } };
    if (/^(no|nope|cancel|stop|don't)\b/.test(l)) return { say: "Okay, I've left everything as it is." };
  }

  if (/\b(help|what can you do|what do you do)\b/.test(l)) return { say: HELP };
  if (/\b(sample|demo)\b.*\b(family|household|data)\b|\bload (the )?sample\b/.test(l)) return { tool: "load_sample_family", args: { confirm: true } };
  if (/\b(forget everything|reset( my)? household|start over|delete my household)\b/.test(l))
    return { ask: "That deletes your whole household. Are you sure?", pending: { confirm: "reset_household" } };

  if (/\b(check|any|my)\b.*\balerts?\b/.test(l)) return { tool: "check_rate_alerts", args: {} };
  if (/\b(tell|let) me (know )?when\b|\balert\b|\bnotify\b|\bwatch\b/.test(l)) {
    const n = [...l.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0])).find((x) => x >= 100);
    if (!n) return { ask: "What naira rate should I watch for?", pending: { intent: "alert", args: { currency: detectCurrency(t) } } };
    const args = { target_rate: n };
    const c = detectCurrency(t);
    if (c) args.currency = c;
    return { tool: "set_rate_alert", args };
  }

  if (/\b(compare|versus|vs\.?|which is (better|cheaper))\b/.test(l)) {
    const amount = parseMoney(raw).send_amount ?? ctx.lastQuote?.send_amount;
    const parts = raw.replace(/^.*?\b(compare|which is (better|cheaper))\b:?/i, "").split(/,|;|\bvs\.?\b|\bversus\b|\band\b/i);
    const quotes = [];
    for (const p of parts) {
      const name =
        p.match(/([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*)?)\s+(?:at|is|offers?|gives?|pays?)?\s*(?:₦\s*)?\d/) ||
        p.match(/\b(?!(?:at|is|for|fee|fees|with|no|and|offers?|gives?|pays?)\b)([a-z][\w.&-]*)\s+(?:at\s+|is\s+|offers?\s+|gives?\s+|pays?\s+)?(?:₦\s*)?\d/i);
      const pm = parseMoney(p);
      const rate = pm.offered_rate ?? [...normalise(p).matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0])).find((n) => n >= 500);
      if (name && rate) {
        const prov = name[1].trim();
        quotes.push({ provider: prov[0].toUpperCase() + prov.slice(1), offered_rate: rate, fee: pm.fee ?? 0 });
      }
    }
    if (quotes.length < 2) return { ask: "Tell me two offers, like: Wise at 1975 fee 0.9, and Lemfi at 1960 with no fee." };
    if (!amount) return { ask: "How much are you sending?", pending: { intent: "compare", args: { quotes } } };
    const args = { send_amount: amount, quotes };
    if (detectCurrency(t)) args.currency = detectCurrency(t);
    return { tool: "compare_quotes", args };
  }

  if (/\bhow much (have|did) i (send|sent)\b|\bsent so far\b/.test(l)) return { tool: "household_summary", args: {} };

  if (/\b(i('ve| have)?\s*(just\s+)?sent|i just sent|log (it|that|a transfer)|record (it|that|a transfer)|done,? sent)\b/.test(l)) {
    const pm = parseMoney(raw);
    const base = ctx.lastQuote || {};
    const args = {
      member_name: findMember(t, members),
      amount_sent: pm.send_amount ?? base.send_amount,
      offered_rate: pm.offered_rate ?? base.offered_rate,
      fee: pm.fee ?? base.fee ?? 0,
    };
    const prov = pm.provider && !findMember(pm.provider, members) ? pm.provider : base.provider;
    if (prov) args.provider = prov;
    return fillOrAsk("log", args);
  }

  // Slot filling for a pending question
  if (ctx.pending?.intent && !/\b(plan|summary|rate today|sample)\b/.test(l)) {
    const pm = parseMoney(raw);
    const a = { ...ctx.pending.args };
    const nums = [...l.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
    if (ctx.pending.intent === "alert") {
      const n = nums.find((x) => x >= 100);
      if (n) return { tool: "set_rate_alert", args: { ...a, target_rate: n } };
    }
    if (ctx.pending.intent === "compare") {
      const n = pm.send_amount ?? nums[0];
      if (n) return { tool: "compare_quotes", args: { ...a, send_amount: n } };
    }
    if (ctx.pending.intent === "log" && !a.member_name) a.member_name = findMember(t, members);
    for (const k of ["send_amount", "offered_rate", "fee", "provider", "currency"]) if (pm[k] !== undefined && a[k] === undefined) a[k] = pm[k];
    if (ctx.pending.intent === "log") {
      if (pm.send_amount !== undefined && a.amount_sent === undefined) a.amount_sent = pm.send_amount;
      if (pm.offered_rate !== undefined && a.offered_rate === undefined) a.offered_rate = pm.offered_rate;
      delete a.send_amount;
    }
    // bare answer to "what rate?" / "how much?"
    if (ctx.pending.need === "offered_rate" && a.offered_rate === undefined) a.offered_rate = nums.find((n) => n >= 500);
    if ((ctx.pending.need === "send_amount" || ctx.pending.need === "amount_sent") && a[ctx.pending.need] === undefined) a[ctx.pending.need] = nums[0];
    if (ctx.pending.need === "fee" && a.fee === undefined) a.fee = /\b(no|none|zero|free)\b/.test(l) ? 0 : nums[0];
    return fillOrAsk(ctx.pending.intent, a);
  }

  const pm = parseMoney(raw);
  if (/\b(sending|send|transfer|quote|good deal|fair deal|good rate|worth it)\b/.test(l) && (pm.send_amount || pm.offered_rate) && !/\bplan\b/.test(l)) {
    return fillOrAsk("quote", pm);
  }

  if (/\b(plan|budget|what('s| is) due|what do i (need|have) to send|this month)\b/.test(l)) {
    const args = {};
    const b = pm.send_amount ?? [...l.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0]))[0];
    if (b) args.budget = b;
    if (/\bnext month\b/.test(l)) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
      args.month = d.toISOString().slice(0, 7);
    }
    return { tool: "plan_month", args };
  }

  if (/\b(summary|household|who (do|am) i|how much (have|did) i send|sent so far|upcoming|what's next|coming up)\b/.test(l)) return { tool: "household_summary", args: {} };

  if (/\b(rate|exchange|how much is (the|a|one)|naira (today|now)|worth in naira|to naira)\b/.test(l)) {
    const c = detectCurrency(t);
    return { tool: "get_naira_rate", args: c ? { currency: c } : {} };
  }

  if (/\b(i send (from|in)|switch to|use) (pounds?|dollars?|euros?|canadian dollars?|gbp|usd|eur|cad)\b/.test(l)) {
    return { tool: "set_home_currency", args: { currency: detectCurrency(t) } };
  }

  // "Ada's school fees are 450,000 naira termly, due 28 October"
  let m = t.match(/^(?:add\s+)?([A-Z]?[a-z]+)(?:'s|s'|\s+needs)\s+(.+?)\s+(?:is|are|of|costs?|for|at)?\s*(?:₦|ngn\s*)?(\d+(?:\.\d+)?)\s*(?:naira|ngn)?/i);
  if (m && /naira|ngn|₦|due|monthly|termly|yearly|every/i.test(raw)) {
    const member = findMember(m[1], members) || m[1];
    const rec = /\b(monthly|every month)\b/i.test(l) ? "monthly" : /\b(termly|every term|per term)\b/i.test(l) ? "termly" : /\b(yearly|annual|every year)\b/i.test(l) ? "yearly" : /\b(once|one[- ]off)\b/i.test(l) ? "once" : "monthly";
    const due = parseDate(l, today);
    const label = m[2].replace(/\b(is|are|of|costs?|for)$/i, "").trim();
    const args = { member_name: member, label, amount_ngn: Number(m[3]), recurrence: rec, priority: /\b(flexible|optional|if possible)\b/i.test(l) ? "flexible" : "essential" };
    if (due) args.next_due = due;
    if (!due) return { ask: `When is ${member}'s ${label} next due?`, pending: { intent: "obligation", args, need: "next_due" } };
    return { tool: "add_obligation", args };
  }
  if (ctx.pending?.intent === "obligation") {
    const due = parseDate(l, today);
    if (due) return { tool: "add_obligation", args: { ...ctx.pending.args, next_due: due } };
  }

  m = t.match(/^(?:add|remember)\s+([A-Z]?[a-z]+)\s*,?\s*(?:my|our|the)?\s*([a-z ]+?)(?:\s*,\s*|\s+(?:on|with|via|uses|using)\s+)?([A-Za-z][\w ]+)?$/i);
  if (m) {
    const args = { name: m[1][0].toUpperCase() + m[1].slice(1), relationship: (m[2] || "family").trim() || "family" };
    if (m[3]) args.payout_note = m[3].trim();
    return { tool: "add_family_member", args };
  }

  return { say: "I didn't catch that. " + HELP };
}

function fillOrAsk(intent, args) {
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  if (intent === "quote") {
    if (clean.send_amount === undefined) return { ask: "How much are you sending?", pending: { intent, args: clean, need: "send_amount" } };
    if (clean.offered_rate === undefined) return { ask: "What naira rate is your app offering?", pending: { intent, args: clean, need: "offered_rate" } };
    if (clean.fee === undefined) return { ask: "And what fee does it charge? Say 'no fee' if it's free.", pending: { intent, args: clean, need: "fee" } };
    return { tool: "check_transfer_quote", args: clean };
  }
  if (intent === "log") {
    if (!clean.member_name) return { ask: "Who did you send it to?", pending: { intent, args: clean, need: "member_name" } };
    if (clean.amount_sent === undefined) return { ask: "How much did you send?", pending: { intent, args: clean, need: "amount_sent" } };
    if (clean.offered_rate === undefined) return { ask: "What naira rate did you get?", pending: { intent, args: clean, need: "offered_rate" } };
    return { tool: "log_transfer", args: { fee: 0, ...clean } };
  }
  return { say: HELP };
}
