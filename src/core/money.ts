import { round } from "./fx.js";
import type { Household, Member, Obligation, Recurrence, SenderCurrency, Transfer } from "./types.js";

export const SYMBOL: Record<SenderCurrency, string> = { USD: "$", GBP: "£", EUR: "€", CAD: "C$" };
export const CURRENCY_WORD: Record<SenderCurrency, string> = {
  USD: "dollar",
  GBP: "pound",
  EUR: "euro",
  CAD: "Canadian dollar",
};

/** UN Sustainable Development Goal 10.c: remittance costs below 3%. */
export const UN_SDG_TARGET_PCT = 3;

// ---------- formatting (screen and voice) ----------

export function fmtNgn(n: number): string {
  return "₦" + Math.round(n).toLocaleString("en-US");
}

/** Voice-friendly naira: "₦350,000", "₦1.25 million". */
export function sayNgn(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) {
    const m = round(n / 1_000_000, a >= 10_000_000 ? 1 : 2);
    return `₦${trimZeros(m)} million`;
  }
  if (a >= 10_000) return "₦" + (Math.round(n / 1000) * 1000).toLocaleString("en-US");
  return fmtNgn(n);
}

export function fmtMoney(n: number, c: SenderCurrency): string {
  return SYMBOL[c] + round(n, 2).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Voice-friendly sender money, whole units when large. */
export function sayMoney(n: number, c: SenderCurrency): string {
  if (Math.abs(n) >= 100) return SYMBOL[c] + Math.round(n).toLocaleString("en-US");
  return fmtMoney(n, c);
}

function trimZeros(n: number): string {
  return String(n).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function sayDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

// ---------- quote analysis ----------

export interface QuoteInput {
  provider?: string;
  currency: SenderCurrency;
  /** Amount converted to naira, in sender currency. */
  sendAmount: number;
  /** Naira per 1 unit offered by the provider. */
  offeredRate: number;
  /** Upfront fee in sender currency, charged on top of sendAmount. */
  fee: number;
}

export type Verdict = "better_than_mid_market" | "excellent" | "within_un_target" | "pricey" | "expensive";

export interface QuoteAnalysis extends QuoteInput {
  midMarketRate: number;
  totalPaid: number;
  ngnDelivered: number;
  ngnAtMidMarket: number;
  /** Naira the family loses versus converting everything you paid at mid-market. */
  ngnLost: number;
  markupPct: number;
  hiddenFxCost: number;
  totalCost: number;
  totalCostPct: number;
  effectiveRate: number;
  verdict: Verdict;
}

export function analyseQuote(q: QuoteInput, midMarketRate: number): QuoteAnalysis {
  if (!(q.sendAmount > 0)) throw new RangeError("send amount must be above zero");
  if (!(q.offeredRate > 0)) throw new RangeError("offered rate must be above zero");
  if (q.fee < 0) throw new RangeError("fee cannot be negative");
  const totalPaid = q.sendAmount + q.fee;
  const ngnDelivered = q.sendAmount * q.offeredRate;
  const ngnAtMidMarket = totalPaid * midMarketRate;
  const hiddenFxCost = q.sendAmount * (1 - q.offeredRate / midMarketRate);
  const totalCost = q.fee + hiddenFxCost;
  const totalCostPct = (totalCost / totalPaid) * 100;
  const markupPct = (1 - q.offeredRate / midMarketRate) * 100;
  let verdict: Verdict;
  if (totalCostPct < 0) verdict = "better_than_mid_market";
  else if (totalCostPct <= 1) verdict = "excellent";
  else if (totalCostPct <= UN_SDG_TARGET_PCT) verdict = "within_un_target";
  else if (totalCostPct <= 6) verdict = "pricey";
  else verdict = "expensive";
  return {
    ...q,
    midMarketRate,
    totalPaid: round(totalPaid),
    ngnDelivered: Math.round(ngnDelivered),
    ngnAtMidMarket: Math.round(ngnAtMidMarket),
    ngnLost: Math.round(ngnAtMidMarket - ngnDelivered),
    markupPct: round(markupPct, 2),
    hiddenFxCost: round(hiddenFxCost),
    totalCost: round(totalCost),
    totalCostPct: round(totalCostPct, 2),
    effectiveRate: round(ngnDelivered / totalPaid, 2),
    verdict,
  };
}

export function verdictPhrase(v: Verdict): string {
  switch (v) {
    case "better_than_mid_market":
      return "better than the mid-market rate, which usually means a promo";
    case "excellent":
      return "an excellent deal";
    case "within_un_target":
      return "a fair deal, inside the UN's 3% target";
    case "pricey":
      return "on the pricey side, above the UN's 3% target";
    case "expensive":
      return "expensive";
  }
}

export function speakQuote(a: QuoteAnalysis): string {
  const who = a.provider ? `${a.provider}'s offer` : "That offer";
  if (a.verdict === "better_than_mid_market") {
    return `${who} delivers ${sayNgn(a.ngnDelivered)}. That's ${verdictPhrase(a.verdict)}, so check it's not a first-transfer-only rate.`;
  }
  return (
    `${who} delivers ${sayNgn(a.ngnDelivered)} and really costs you ${sayMoney(a.totalCost, a.currency)}, ` +
    `about ${trimZeros(round(a.totalCostPct, 1))}% once the rate markup is counted. That's ${verdictPhrase(a.verdict)}.`
  );
}

export function rankQuotes(list: QuoteAnalysis[]): QuoteAnalysis[] {
  return [...list].sort((x, y) => y.effectiveRate - x.effectiveRate);
}

// ---------- dates and recurrence ----------

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return isoDate(target);
}

const STEP: Record<Recurrence, number> = { once: 0, monthly: 1, termly: 4, yearly: 12 };

/** Returns the next due date after paying, or null when a one-off is done. */
export function advanceDue(o: Obligation): string | null {
  if (o.recurrence === "once") return null;
  return addMonths(o.nextDue, STEP[o.recurrence]);
}

export function monthBounds(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const start = isoDate(new Date(Date.UTC(y, m - 1, 1)));
  const end = isoDate(new Date(Date.UTC(y, m, 0)));
  return { start, end };
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// ---------- monthly plan (the agentic core) ----------

export interface PlanItem {
  obligationId: string;
  member: string;
  label: string;
  category: string;
  amountNgn: number;
  due: string;
  overdue: boolean;
  priority: "essential" | "flexible";
  senderNeeded: number;
  status: "fund" | "defer";
}

export interface PlanTransfer {
  member: string;
  payoutNote?: string;
  amountNgn: number;
  senderAmount: number;
  covers: string[];
}

export interface SetAside {
  member: string;
  label: string;
  amountNgn: number;
  due: string;
  monthsLeft: number;
  perMonthNgn: number;
  perMonthSender: number;
}

export interface MonthPlan {
  month: string;
  currency: SenderCurrency;
  midMarketRate: number;
  assumedCostPct: number;
  assumedCostBasis: string;
  planningRate: number;
  items: PlanItem[];
  transfers: PlanTransfer[];
  setAsides: SetAside[];
  totalNgnDue: number;
  totalSenderNeeded: number;
  budget: number | null;
  fundedSender: number;
  deferredNgn: number;
  shortfallSender: number;
}

/**
 * Assumed all-in cost of your usual provider, learnt from the transfers you logged.
 * Falls back to the UN 3% target when there is no history, and says so.
 */
export function learnedCostPct(h: Household): { pct: number; basis: string } {
  const recent = h.transfers.filter((t) => t.hiddenCostSender !== null && t.currency === h.senderCurrency).slice(-5);
  if (recent.length === 0) return { pct: UN_SDG_TARGET_PCT, basis: "no transfers logged yet, so I assumed a 3% all-in cost" };
  const paid = recent.reduce((s, t) => s + t.amountSent + t.fee, 0);
  const cost = recent.reduce((s, t) => s + t.fee + (t.hiddenCostSender ?? 0), 0);
  const pct = Math.max(0, round((cost / paid) * 100, 2));
  return { pct, basis: `average all-in cost of your last ${recent.length} logged transfer${recent.length > 1 ? "s" : ""}` };
}

export function planMonth(
  h: Household,
  opts: { today: string; month?: string; budget?: number | null; midMarketRate: number },
): MonthPlan {
  const month = opts.month ?? opts.today.slice(0, 7);
  const { end } = monthBounds(month);
  const { pct, basis } = learnedCostPct(h);
  const planningRate = opts.midMarketRate * (1 - pct / 100);
  const memberById = new Map<string, Member>(h.members.map((m) => [m.id, m]));
  const nameOf = (id: string) => memberById.get(id)?.name ?? "Unknown";

  const due = h.obligations
    .filter((o) => o.nextDue <= end)
    .sort((a, b) => (a.priority === b.priority ? a.nextDue.localeCompare(b.nextDue) : a.priority === "essential" ? -1 : 1));

  const budget = opts.budget ?? null;
  let remaining = budget ?? Infinity;
  const items: PlanItem[] = due.map((o) => {
    const senderNeeded = round(o.amountNgn / planningRate);
    const fits = senderNeeded <= remaining + 1e-9;
    if (fits) remaining -= senderNeeded;
    return {
      obligationId: o.id,
      member: nameOf(o.memberId),
      label: o.label,
      category: o.category,
      amountNgn: o.amountNgn,
      due: o.nextDue,
      overdue: o.nextDue < opts.today,
      priority: o.priority,
      senderNeeded,
      status: fits ? "fund" : "defer",
    };
  });

  const byMember = new Map<string, PlanTransfer>();
  for (const it of items.filter((i) => i.status === "fund")) {
    const o = h.obligations.find((x) => x.id === it.obligationId)!;
    const t = byMember.get(o.memberId) ?? {
      member: it.member,
      payoutNote: memberById.get(o.memberId)?.payoutNote,
      amountNgn: 0,
      senderAmount: 0,
      covers: [],
    };
    t.amountNgn += it.amountNgn;
    t.senderAmount = round(t.senderAmount + it.senderNeeded);
    t.covers.push(it.label);
    byMember.set(o.memberId, t);
  }

  const horizon = addMonths(end, 6);
  const setAsides: SetAside[] = h.obligations
    .filter((o) => o.nextDue > end && o.nextDue <= horizon && o.amountNgn >= 200_000)
    .map((o) => {
      const monthsLeft = Math.max(1, monthsBetween(month + "-01", o.nextDue));
      const perMonthNgn = Math.ceil(o.amountNgn / monthsLeft / 1000) * 1000;
      return {
        member: nameOf(o.memberId),
        label: o.label,
        amountNgn: o.amountNgn,
        due: o.nextDue,
        monthsLeft,
        perMonthNgn,
        perMonthSender: round(perMonthNgn / planningRate),
      };
    })
    .sort((a, b) => b.perMonthNgn - a.perMonthNgn || a.due.localeCompare(b.due));

  const totalNgnDue = items.reduce((s, i) => s + i.amountNgn, 0);
  const totalSenderNeeded = round(items.reduce((s, i) => s + i.senderNeeded, 0));
  const fundedSender = round(items.filter((i) => i.status === "fund").reduce((s, i) => s + i.senderNeeded, 0));
  const deferredNgn = items.filter((i) => i.status === "defer").reduce((s, i) => s + i.amountNgn, 0);
  return {
    month,
    currency: h.senderCurrency,
    midMarketRate: opts.midMarketRate,
    assumedCostPct: pct,
    assumedCostBasis: basis,
    planningRate: round(planningRate, 2),
    items,
    transfers: [...byMember.values()],
    setAsides,
    totalNgnDue,
    totalSenderNeeded,
    budget,
    fundedSender,
    deferredNgn,
    shortfallSender: budget === null ? 0 : round(Math.max(0, totalSenderNeeded - budget)),
  };
}

export function speakPlan(p: MonthPlan): string {
  const c = p.currency;
  if (p.items.length === 0) {
    const next = p.setAsides[0];
    return next
      ? `Nothing is due this month. ${next.member}'s ${next.label} of ${sayNgn(next.amountNgn)} is due ${sayDate(next.due)}, so putting aside ${sayMoney(next.perMonthSender, c)} a month keeps you ahead.`
      : "Nothing is due this month. Add an obligation, like rent or school fees, and I'll plan around it.";
  }
  const overdue = p.items.filter((i) => i.overdue);
  let s = `This month you have ${p.items.length} item${p.items.length > 1 ? "s" : ""} worth ${sayNgn(p.totalNgnDue)}, about ${sayMoney(p.totalSenderNeeded, c)} at today's rate.`;
  if (overdue.length) s += ` ${overdue.map((o) => `${o.member}'s ${o.label}`).join(" and ")} ${overdue.length > 1 ? "are" : "is"} already overdue.`;
  if (p.budget !== null) {
    const deferred = p.items.filter((i) => i.status === "defer");
    if (deferred.length === 0) s += ` It all fits in your ${sayMoney(p.budget, c)} budget.`;
    else
      s += ` Your ${sayMoney(p.budget, c)} budget covers the essentials first; I'd move ${deferred
        .map((d) => `${d.member}'s ${d.label}`)
        .join(" and ")} to later, a gap of ${sayMoney(p.shortfallSender, c)}.`;
  }
  if (p.transfers.length) s += ` That's ${p.transfers.length} transfer${p.transfers.length > 1 ? "s" : ""}: ${p.transfers.map((t) => `${sayMoney(t.senderAmount, c)} to ${t.member}`).join(", ")}.`;
  const big = p.setAsides[0];
  if (big) {
    s += ` Heads up: ${big.member}'s ${big.label}, ${sayNgn(big.amountNgn)}, is due ${sayDate(big.due)}; set aside ${sayMoney(big.perMonthSender, c)} a month.`;
    if (p.budget !== null) {
      const left = round(p.budget - p.fundedSender);
      if (left >= big.perMonthSender) s += ` Your ${sayMoney(left, c)} left over covers that.`;
      else if (left > 0) s += ` Your ${sayMoney(left, c)} left over is a start.`;
    }
    if (p.setAsides.length > 1) s += ` ${p.setAsides.length - 1} more big bill${p.setAsides.length > 2 ? "s are" : " is"} on the card.`;
  }
  return s;
}

// ---------- history ----------

export function sentInPeriod(h: Household, prefix: string): { count: number; sent: number; ngn: number; cost: number } {
  const list: Transfer[] = h.transfers.filter((t) => t.at.startsWith(prefix) && t.currency === h.senderCurrency);
  return {
    count: list.length,
    sent: round(list.reduce((s, t) => s + t.amountSent + t.fee, 0)),
    ngn: list.reduce((s, t) => s + t.ngnDelivered, 0),
    cost: round(list.reduce((s, t) => s + t.fee + (t.hiddenCostSender ?? 0), 0)),
  };
}
