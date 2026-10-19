import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FxUnavailableError, round, type FxProvider, type FxQuote } from "../core/fx.js";
import {
  CURRENCY_WORD,
  advanceDue,
  analyseQuote,
  fmtMoney,
  fmtNgn,
  isoDate,
  learnedCostPct,
  planMonth,
  rankQuotes,
  sayDate,
  sayMoney,
  sayNgn,
  sentInPeriod,
  speakPlan,
  speakQuote,
} from "../core/money.js";
import { sampleHousehold } from "../core/sample.js";
import { emptyHousehold, type HouseholdStore } from "../core/store.js";
import { CATEGORIES, RECURRENCES, SENDER_CURRENCIES, type Household, type Member, type SenderCurrency } from "../core/types.js";
import { CARD_HTML, CARD_URI, MCP_APP_MIME } from "./card.js";

export const SERVER_NAME = "nairahome";
export const SERVER_VERSION = "1.0.0";

export interface ServerDeps {
  store: HouseholdStore;
  fx: FxProvider;
  householdId: string;
  now?: () => Date;
}

const currency = z.enum(SENDER_CURRENCIES);
const money = z.number().positive().max(1_000_000);

/** Every tool answers with the same envelope: a short Alexa-ready line, plus data a screen can render. */
const envelope = {
  speech: z.string().describe("One to three short sentences written to be spoken by Alexa."),
  kind: z.string().describe("Card type for multimodal devices: rate, quote, compare, plan, summary, household, alerts, ok."),
  data: z.record(z.string(), z.unknown()),
};
const cardMeta = { ui: { resourceUri: CARD_URI } };

type Payload = { speech: string; kind: string; data: Record<string, unknown> };

function ok(p: Payload): CallToolResult {
  return { content: [{ type: "text", text: p.speech }], structuredContent: p };
}

function fail(message: string): CallToolResult {
  const p: Payload = { speech: message, kind: "error", data: { error: message } };
  return { content: [{ type: "text", text: message }], structuredContent: p, isError: true };
}

function sourceOf(q: FxQuote) {
  return { rate: q.ngnPerUnit, currency: q.currency, source: q.source, asOf: q.asOf, mode: q.mode };
}

function demoNote(q: FxQuote): string {
  return q.mode === "demo" ? " (Demo mode rate, not a real market price.)" : "";
}

function findMember(h: Household, name: string): Member | undefined {
  const n = name.trim().toLowerCase();
  return (
    h.members.find((m) => m.name.toLowerCase() === n) ??
    h.members.find((m) => m.relationship.toLowerCase().split(/[ ,]+/).includes(n)) ??
    h.members.find((m) => m.name.toLowerCase().startsWith(n))
  );
}

export function createNairaHomeServer(deps: ServerDeps): McpServer {
  const now = deps.now ?? (() => new Date());
  const server = new McpServer(
    { name: SERVER_NAME, title: "NairaHome", version: SERVER_VERSION, websiteUrl: "https://github.com/Quantumwoof/nairahome-mcp" },
    {
      instructions:
        "NairaHome helps people abroad support family in Nigeria. It remembers the household (family members and what they need: rent, school fees, upkeep), " +
        "prices transfers against the live mid-market naira rate, plans each month's sends inside a budget, and tracks what was sent. " +
        "Never invent a provider's exchange rate: ask the user what their app is offering and pass it to check_transfer_quote. " +
        "Read the `speech` field aloud; render `data` on screen when there is one. Amounts in naira are NGN; sender amounts are in the household currency.",
      capabilities: { logging: {} },
    },
  );

  const load = async (): Promise<Household> =>
    (await deps.store.load(deps.householdId)) ?? emptyHousehold(deps.householdId, "GBP", now());
  const save = async (h: Household) => {
    h.updatedAt = now().toISOString();
    await deps.store.save(h);
  };
  const rate = async (c: SenderCurrency) => deps.fx.getRate(c);
  const guard =
    <A,>(fn: (a: A) => Promise<CallToolResult>) =>
    async (a: A): Promise<CallToolResult> => {
      try {
        return await fn(a);
      } catch (e) {
        if (e instanceof FxUnavailableError) return fail(`${e.message} I won't guess a rate; please try again in a minute.`);
        return fail(e instanceof Error ? e.message : String(e));
      }
    };

  // ---------------------------------------------------------------- rates

  server.registerTool(
    "get_naira_rate",
    {
      title: "Today's naira rate",
      description:
        "Live mid-market reference rate: how many naira one dollar, pound, euro or Canadian dollar buys today. Also reports any rate alert it triggers. " +
        "This is the benchmark, not what a transfer app pays out.",
      inputSchema: { currency: currency.optional().describe("Defaults to the household's currency.") },
      outputSchema: envelope,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: cardMeta,
    },
    guard(async ({ currency: c }) => {
      const h = await load();
      const cur = c ?? h.senderCurrency;
      const q = await rate(cur);
      const hits = h.alerts.filter((a) => a.currency === cur && !a.triggeredAt && q.ngnPerUnit >= a.targetNgnPerUnit);
      if (hits.length) {
        hits.forEach((a) => (a.triggeredAt = now().toISOString()));
        await save(h);
      }
      let speech = `One ${CURRENCY_WORD[cur]} is about ${fmtNgn(q.ngnPerUnit)} at today's mid-market rate.${demoNote(q)}`;
      if (hits.length) speech += ` Good news: that's above your ${fmtNgn(hits[0].targetNgnPerUnit)} alert.`;
      speech += " Transfer apps pay a bit less; tell me their rate and I'll show the real cost.";
      return ok({ speech, kind: "rate", data: { ...sourceOf(q), alertsTriggered: hits } });
    }),
  );

  server.registerTool(
    "check_transfer_quote",
    {
      title: "What does this transfer really cost?",
      description:
        "Price one transfer the user is about to make. Pass exactly what their app shows: amount, the naira rate offered and the fee. " +
        "Returns naira delivered, the hidden exchange-rate markup, true all-in cost and a verdict against the UN 3% remittance-cost target.",
      inputSchema: {
        send_amount: money.describe("Amount being converted, in the sender currency."),
        offered_rate: z.number().positive().describe("Naira per 1 unit that the app is offering."),
        fee: z.number().min(0).max(10_000).default(0).describe("Upfront fee in the sender currency."),
        currency: currency.optional(),
        provider: z.string().max(60).optional().describe("Name of the transfer app, as the user said it."),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: cardMeta,
    },
    guard(async ({ send_amount, offered_rate, fee, currency: c, provider }) => {
      const h = await load();
      const cur = c ?? h.senderCurrency;
      const q = await rate(cur);
      const sanity = offered_rate / q.ngnPerUnit;
      if (sanity < 0.8 || sanity > 1.25) {
        return fail(
          `${fmtNgn(offered_rate)} per ${CURRENCY_WORD[cur]} is far from today's ${fmtNgn(q.ngnPerUnit)} mid-market rate. Please double-check the rate and currency.`,
        );
      }
      const a = analyseQuote({ provider, currency: cur, sendAmount: send_amount, offeredRate: offered_rate, fee }, q.ngnPerUnit);
      return ok({ speech: speakQuote(a) + demoNote(q), kind: "quote", data: { quote: a, fx: sourceOf(q) } });
    }),
  );

  server.registerTool(
    "compare_quotes",
    {
      title: "Compare transfer offers",
      description:
        "Rank two to six offers the user has seen for the same amount (from different apps). Ranked by naira delivered per unit paid, fees included.",
      inputSchema: {
        send_amount: money,
        currency: currency.optional(),
        quotes: z
          .array(z.object({ provider: z.string().min(1).max(60), offered_rate: z.number().positive(), fee: z.number().min(0).max(10_000).default(0) }))
          .min(2)
          .max(6),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: cardMeta,
    },
    guard(async ({ send_amount, currency: c, quotes }) => {
      const h = await load();
      const cur = c ?? h.senderCurrency;
      const q = await rate(cur);
      const ranked = rankQuotes(
        quotes.map((x) => analyseQuote({ provider: x.provider, currency: cur, sendAmount: send_amount, offeredRate: x.offered_rate, fee: x.fee }, q.ngnPerUnit)),
      );
      const [best, ...rest] = ranked;
      const worst = rest[rest.length - 1];
      const gap = best.ngnDelivered - worst.ngnDelivered;
      const speech =
        `${best.provider} is best: ${sayNgn(best.ngnDelivered)} delivered for ${sayMoney(best.totalPaid, cur)}, about ${round(best.totalCostPct, 1)}% all-in. ` +
        (gap > 0 ? `That's ${sayNgn(gap)} more than ${worst.provider}.` : "The others deliver the same.") +
        demoNote(q);
      return ok({ speech, kind: "compare", data: { ranked, fx: sourceOf(q) } });
    }),
  );

  // ---------------------------------------------------------------- household memory

  server.registerTool(
    "add_family_member",
    {
      title: "Add someone you support",
      description: "Remember a person at home the user sends money to. Never store bank account numbers; a payout hint like 'OPay wallet' is enough.",
      inputSchema: {
        name: z.string().min(1).max(40),
        relationship: z.string().min(1).max(60).describe("e.g. mother, younger brother, landlord"),
        payout_note: z.string().max(60).optional().describe("Where the money lands, e.g. 'GTBank' or 'OPay wallet'. No account numbers."),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    guard(async ({ name, relationship, payout_note }) => {
      if (payout_note && /\d{6,}/.test(payout_note)) return fail("Please don't share account numbers with me. A hint like 'GTBank' is enough.");
      const h = await load();
      const existing = h.members.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) {
        existing.relationship = relationship;
        if (payout_note) existing.payoutNote = payout_note;
      } else if (h.members.length >= 30) {
        return fail("You already have 30 people saved. Remove someone before adding more.");
      } else h.members.push({ id: "m_" + randomUUID().slice(0, 8), name: name.trim(), relationship, payoutNote: payout_note });
      await save(h);
      return ok({
        speech: existing ? `Updated ${name}.` : `Got it, I'll remember ${name}, your ${relationship}. What do they usually need, and when?`,
        kind: "household",
        data: { members: h.members },
      });
    }),
  );

  server.registerTool(
    "add_obligation",
    {
      title: "Add something to cover",
      description:
        "Remember a recurring or one-off need for a family member: rent, school fees, monthly upkeep, medication, a project. Amount is in naira. " +
        "Termly means every four months (Nigerian school terms).",
      inputSchema: {
        member_name: z.string().min(1).max(40),
        label: z.string().min(1).max(60).describe("Short name, e.g. 'school fees'"),
        amount_ngn: z.number().positive().max(1_000_000_000),
        next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
        recurrence: z.enum(RECURRENCES).default("monthly"),
        category: z.enum(CATEGORIES).default("other"),
        priority: z.enum(["essential", "flexible"]).default("essential"),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    guard(async (a) => {
      const h = await load();
      const m = findMember(h, a.member_name);
      if (!m) return fail(`I don't know ${a.member_name} yet. Add them first with their relationship to you.`);
      const label = a.label.trim();
      const prior = h.obligations.find((o) => o.memberId === m.id && o.label.toLowerCase() === label.toLowerCase());
      const o = {
        id: prior?.id ?? "o_" + randomUUID().slice(0, 8),
        memberId: m.id,
        label,
        category: a.category,
        amountNgn: Math.round(a.amount_ngn),
        recurrence: a.recurrence,
        nextDue: a.next_due,
        priority: a.priority,
      };
      if (prior) Object.assign(prior, o);
      else if (h.obligations.length >= 100) return fail("You already have 100 obligations saved. Remove one before adding more.");
      else h.obligations.push(o);
      await save(h);
      const rec = a.recurrence === "once" ? "once" : a.recurrence;
      return ok({
        speech: `${prior ? "Updated" : "Saved"}: ${m.name}'s ${label}, ${sayNgn(o.amountNgn)}, ${rec}, next due ${sayDate(o.nextDue)}.`,
        kind: "household",
        data: { obligation: o },
      });
    }),
  );

  server.registerTool(
    "remove_obligation",
    {
      title: "Remove something to cover",
      description: "Forget an obligation, e.g. when school fees end. Matches by member and label.",
      inputSchema: { member_name: z.string().min(1), label: z.string().min(1) },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ member_name, label }) => {
      const h = await load();
      const m = findMember(h, member_name);
      const i = h.obligations.findIndex((o) => o.memberId === m?.id && o.label.toLowerCase().includes(label.trim().toLowerCase()));
      if (!m || i < 0) return fail(`I couldn't find ${label} for ${member_name}.`);
      const [gone] = h.obligations.splice(i, 1);
      await save(h);
      return ok({ speech: `Removed ${m.name}'s ${gone.label}.`, kind: "ok", data: { removed: gone } });
    }),
  );

  server.registerTool(
    "set_home_currency",
    {
      title: "Set the currency you send from",
      description: "The currency the user earns and sends in (USD, GBP, EUR or CAD).",
      inputSchema: { currency },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    guard(async ({ currency: c }) => {
      const h = await load();
      h.senderCurrency = c;
      await save(h);
      return ok({ speech: `Done. I'll plan in ${CURRENCY_WORD[c]}s from now on.`, kind: "ok", data: { currency: c } });
    }),
  );

  // ---------------------------------------------------------------- planning

  server.registerTool(
    "plan_month",
    {
      title: "Plan this month's money home",
      description:
        "The main workflow. Reads everything the household needs this month (including overdue items), converts it at the live rate adjusted by the user's " +
        "real transfer cost learnt from logged transfers, fits it to an optional budget (essentials first, then by due date), groups it into one transfer " +
        "per person, and flags big bills in the next six months with a monthly set-aside.",
      inputSchema: {
        budget: z.number().positive().max(1_000_000).optional().describe("What the user can send this month, in the sender currency."),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, defaults to the current month."),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: cardMeta,
    },
    guard(async ({ budget, month }) => {
      const h = await load();
      if (h.members.length === 0) {
        return ok({
          speech: "I don't know your family yet. Tell me who you support at home and what they need, or say 'load the sample family' to try it.",
          kind: "plan",
          data: { empty: true },
        });
      }
      const q = await rate(h.senderCurrency);
      const plan = planMonth(h, { today: isoDate(now()), month, budget: budget ?? null, midMarketRate: q.ngnPerUnit });
      const hits = h.alerts.filter((a) => a.currency === h.senderCurrency && !a.triggeredAt && q.ngnPerUnit >= a.targetNgnPerUnit);
      if (hits.length) {
        hits.forEach((a) => (a.triggeredAt = now().toISOString()));
        await save(h);
      }
      const alertLine = hits.length ? ` Your ${fmtNgn(hits[0].targetNgnPerUnit)} rate alert has been hit, so it's a good day to send.` : "";
      return ok({
        speech: speakPlan(plan) + alertLine + demoNote(q),
        kind: "plan",
        data: { plan, fx: sourceOf(q), sample: !!h.isSample, alertsTriggered: hits },
      });
    }),
  );

  server.registerTool(
    "log_transfer",
    {
      title: "Record a transfer you sent",
      description:
        "Record money the user has sent (after they send it in their own app; NairaHome never moves money). Prices it against the live rate, " +
        "marks the covered obligations as paid and rolls recurring ones to their next due date. If `covers` is omitted, it settles the member's items " +
        "due this month, earliest first, up to the naira delivered.",
      inputSchema: {
        member_name: z.string().min(1).max(40),
        amount_sent: money.describe("Amount converted, in sender currency."),
        offered_rate: z.number().positive().describe("Naira per unit the app gave."),
        fee: z.number().min(0).max(10_000).default(0),
        provider: z.string().max(60).optional(),
        covers: z.array(z.string().max(60)).max(10).optional().describe("Obligation labels this transfer pays for."),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard(async (a) => {
      const h = await load();
      const m = findMember(h, a.member_name);
      if (!m) return fail(`I don't know ${a.member_name} yet.`);
      let q: FxQuote | null = null;
      try {
        q = await rate(h.senderCurrency);
      } catch {
        q = null;
      }
      const analysis = q
        ? analyseQuote({ provider: a.provider, currency: h.senderCurrency, sendAmount: a.amount_sent, offeredRate: a.offered_rate, fee: a.fee }, q.ngnPerUnit)
        : null;
      const delivered = Math.round(a.amount_sent * a.offered_rate);
      const endOfMonth = isoDate(new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth() + 1, 0)));
      const mine = h.obligations.filter((o) => o.memberId === m.id).sort((x, y) => x.nextDue.localeCompare(y.nextDue));
      const covered = a.covers?.length
        ? mine.filter((o) => a.covers!.some((c) => o.label.toLowerCase().includes(c.toLowerCase())))
        : [];
      if (!a.covers?.length) {
        let left = delivered;
        for (const o of mine.filter((o) => o.nextDue <= endOfMonth)) {
          if (o.amountNgn <= left + 1) {
            covered.push(o);
            left -= o.amountNgn;
          }
        }
      }
      const rolled: { label: string; nextDue: string | null }[] = [];
      for (const o of covered) {
        const next = advanceDue(o);
        rolled.push({ label: o.label, nextDue: next });
        if (next) o.nextDue = next;
        else h.obligations = h.obligations.filter((x) => x.id !== o.id);
      }
      h.transfers.push({
        id: "t_" + randomUUID().slice(0, 8),
        at: now().toISOString(),
        memberId: m.id,
        provider: a.provider,
        currency: h.senderCurrency,
        amountSent: a.amount_sent,
        fee: a.fee,
        offeredRate: a.offered_rate,
        midMarketRate: q?.ngnPerUnit ?? null,
        ngnDelivered: delivered,
        hiddenCostSender: analysis ? round(analysis.hiddenFxCost) : null,
        obligationIds: covered.map((o) => o.id),
      });
      if (h.transfers.length > 500) h.transfers = h.transfers.slice(-500);
      await save(h);
      let speech = `Logged ${sayNgn(delivered)} to ${m.name}.`;
      if (rolled.length) {
        speech += ` Marked ${rolled.map((r) => r.label).join(" and ")} as paid`;
        const nextOne = rolled.find((r) => r.nextDue);
        speech += nextOne ? `; ${nextOne.label} next due ${sayDate(nextOne.nextDue!)}.` : ".";
      } else {
        const nextDue = mine.find((o) => o.nextDue <= endOfMonth);
        speech += nextDue
          ? ` That's ${sayNgn(nextDue.amountNgn - delivered)} short of ${m.name}'s ${nextDue.label} (${sayNgn(nextDue.amountNgn)}), so I haven't marked it paid.`
          : ` Nothing of ${m.name}'s was due this month, so it's logged as extra support.`;
      }
      if (analysis && analysis.totalCostPct > 3) speech += ` That transfer cost about ${round(analysis.totalCostPct, 1)}% all-in, above the UN 3% target.`;
      return ok({ speech, kind: "ok", data: { delivered, covered: rolled, quote: analysis, fx: q ? sourceOf(q) : null } });
    }),
  );

  server.registerTool(
    "household_summary",
    {
      title: "Household summary",
      description: "Who the user supports, what's coming up next, and what they've sent this month and this year (with the total hidden in fees and markups).",
      inputSchema: {},
      outputSchema: envelope,
      annotations: { readOnlyHint: true },
      _meta: cardMeta,
    },
    guard(async () => {
      const h = await load();
      const today = isoDate(now());
      const month = sentInPeriod(h, today.slice(0, 7));
      const year = sentInPeriod(h, today.slice(0, 4));
      const upcoming = [...h.obligations]
        .sort((a, b) => a.nextDue.localeCompare(b.nextDue))
        .slice(0, 5)
        .map((o) => ({ ...o, member: h.members.find((m) => m.id === o.memberId)?.name ?? "?" , overdue: o.nextDue < today }));
      const cur = h.senderCurrency;
      const cost = learnedCostPct(h);
      let speech: string;
      if (h.members.length === 0) speech = "Your household is empty. Tell me who you support at home, or load the sample family.";
      else {
        speech = `You support ${h.members.map((m) => m.name).join(", ")}.`;
        if (upcoming[0]) speech += ` Next up: ${upcoming[0].member}'s ${upcoming[0].label}, ${sayNgn(upcoming[0].amountNgn)}, due ${sayDate(upcoming[0].nextDue)}.`;
        speech += month.count
          ? ` This month you've sent ${sayNgn(month.ngn)} in ${month.count} transfer${month.count > 1 ? "s" : ""}, and ${sayMoney(month.cost, cur)} went on fees and markups.`
          : " You haven't logged a transfer this month.";
      }
      return ok({
        speech,
        kind: "summary",
        data: {
          currency: cur,
          members: h.members,
          upcoming,
          thisMonth: month,
          thisYear: year,
          learnedCostPct: cost.pct,
          learnedCostBasis: cost.basis,
          alerts: h.alerts,
          sample: !!h.isSample,
          store: { kind: deps.store.kind, durable: deps.store.durable },
        },
      });
    }),
  );

  // ---------------------------------------------------------------- alerts

  server.registerTool(
    "set_rate_alert",
    {
      title: "Tell me when the naira rate is good",
      description: "Remember a target mid-market rate (naira per unit). get_naira_rate and check_rate_alerts report when it's reached.",
      inputSchema: { target_rate: z.number().positive(), currency: currency.optional() },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    guard(async ({ target_rate, currency: c }) => {
      const h = await load();
      const cur = c ?? h.senderCurrency;
      const q = await rate(cur);
      h.alerts = h.alerts.filter((a) => !(a.currency === cur && !a.triggeredAt)).slice(-9);
      const already = q.ngnPerUnit >= target_rate;
      h.alerts.push({
        id: "a_" + randomUUID().slice(0, 8),
        currency: cur,
        targetNgnPerUnit: target_rate,
        createdAt: now().toISOString(),
        triggeredAt: already ? now().toISOString() : undefined,
      });
      await save(h);
      const gapPct = round(((target_rate - q.ngnPerUnit) / q.ngnPerUnit) * 100, 1);
      return ok({
        speech: already
          ? `The rate is already ${fmtNgn(q.ngnPerUnit)}, at or above ${fmtNgn(target_rate)}. Now's a good time to send.${demoNote(q)}`
          : `Okay. I'll flag it when one ${CURRENCY_WORD[cur]} reaches ${fmtNgn(target_rate)}. It's ${fmtNgn(q.ngnPerUnit)} now, ${gapPct}% away.${demoNote(q)}`,
        kind: "alerts",
        data: { alerts: h.alerts, fx: sourceOf(q) },
      });
    }),
  );

  server.registerTool(
    "check_rate_alerts",
    {
      title: "Check my rate alerts",
      description: "Compare saved rate alerts with the live mid-market rate.",
      inputSchema: {},
      outputSchema: envelope,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const h = await load();
      if (h.alerts.length === 0) return ok({ speech: "You have no rate alerts. Say, for example, 'tell me when the pound hits two thousand naira'.", kind: "alerts", data: { alerts: [] } });
      const lines: string[] = [];
      let changed = false;
      for (const a of h.alerts) {
        const q = await rate(a.currency);
        if (!a.triggeredAt && q.ngnPerUnit >= a.targetNgnPerUnit) {
          a.triggeredAt = now().toISOString();
          changed = true;
        }
        lines.push(
          a.triggeredAt
            ? `${a.currency} hit your ${fmtNgn(a.targetNgnPerUnit)} target; it's ${fmtNgn(q.ngnPerUnit)} now.`
            : `${a.currency} is at ${fmtNgn(q.ngnPerUnit)}, still below your ${fmtNgn(a.targetNgnPerUnit)} target.`,
        );
      }
      if (changed) await save(h);
      return ok({ speech: lines.join(" "), kind: "alerts", data: { alerts: h.alerts } });
    }),
  );

  // ---------------------------------------------------------------- demo helpers

  server.registerTool(
    "load_sample_family",
    {
      title: "Load the sample family (demo)",
      description: "Replace this household with a clearly labelled sample family (Mum, Dad, Ada) dated around today, so the planner can be tried at once.",
      inputSchema: { confirm: z.boolean().describe("Must be true: this replaces the current household.") },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ confirm }) => {
      if (!confirm) return fail("Loading the sample replaces your household. Ask again with confirm set to true.");
      const h = sampleHousehold(deps.householdId, now());
      await save(h);
      return ok({
        speech: "Sample family loaded: Mum, Dad and Ada, with upkeep, medication, school fees and rent. This is demo data. Try 'plan my month with 600 pounds'.",
        kind: "household",
        data: { members: h.members, obligations: h.obligations, sample: true },
      });
    }),
  );

  server.registerTool(
    "reset_household",
    {
      title: "Forget everything",
      description: "Delete this household's family, obligations, transfers and alerts.",
      inputSchema: { confirm: z.boolean() },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ confirm }) => {
      if (!confirm) return fail("This deletes your household. Ask again with confirm set to true.");
      const h = await load();
      await save(emptyHousehold(deps.householdId, h.senderCurrency, now()));
      return ok({ speech: "Done. I've forgotten your household.", kind: "ok", data: {} });
    }),
  );

  // ---------------------------------------------------------------- resources

  server.registerResource(
    "household",
    "nairahome://household",
    { title: "Current household", description: "The remembered family, obligations, transfers and alerts as JSON.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await load(), null, 2) }] }),
  );

  server.registerResource(
    "nairahome-card",
    CARD_URI,
    {
      title: "NairaHome card (MCP App)",
      description: "Interactive card for multimodal screens such as Echo Show. Renders the structuredContent of rate, quote, compare, plan and summary results.",
      mimeType: MCP_APP_MIME,
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: CARD_HTML }] }),
  );

  // ---------------------------------------------------------------- prompts

  server.registerPrompt(
    "monthly_check_in",
    {
      title: "Monthly check-in",
      description: "Walk through this month's money home: plan, price the send, log it.",
      argsSchema: { budget: z.string().optional().describe("Budget in your currency, e.g. 600") },
    },
    ({ budget }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Run my monthly money-home check-in. Call plan_month${budget ? ` with budget ${budget}` : ""}, read me the plan, ` +
              "then ask what rate and fee my transfer app is showing so you can call check_transfer_quote before I send. After I confirm I've sent it, call log_transfer.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "before_i_send",
    {
      title: "Before I send",
      description: "Check a transfer's true cost before sending.",
      argsSchema: { amount: z.string(), rate: z.string(), fee: z.string().optional(), provider: z.string().optional() },
    },
    ({ amount, rate: r, fee, provider }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I'm about to send ${amount}${provider ? ` with ${provider}` : ""} at ${r} naira per unit${fee ? ` with a ${fee} fee` : ""}. Call check_transfer_quote and tell me if it's a fair deal.`,
          },
        },
      ],
    }),
  );

  return server;
}

