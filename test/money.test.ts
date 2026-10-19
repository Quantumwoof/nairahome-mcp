import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths, analyseQuote, planMonth, sayNgn, speakPlan } from "../src/core/money.js";
import { sampleHousehold } from "../src/core/sample.js";

test("quote: fee plus rate markup is the true cost", () => {
  // £200 at ₦1,940 vs ₦2,000 mid, £2 fee
  const a = analyseQuote({ currency: "GBP", sendAmount: 200, offeredRate: 1940, fee: 2 }, 2000);
  assert.equal(a.ngnDelivered, 388_000);
  assert.equal(a.hiddenFxCost, 6); // 200 * 3%
  assert.equal(a.totalCost, 8);
  assert.equal(a.totalCostPct, 3.96);
  assert.equal(a.ngnLost, 404_000 - 388_000);
  assert.equal(a.verdict, "pricey");
});

test("quote: verdict bands and promo rates", () => {
  assert.equal(analyseQuote({ currency: "USD", sendAmount: 100, offeredRate: 1495, fee: 0 }, 1500).verdict, "excellent");
  assert.equal(analyseQuote({ currency: "USD", sendAmount: 100, offeredRate: 1470, fee: 0 }, 1500).verdict, "within_un_target");
  assert.equal(analyseQuote({ currency: "USD", sendAmount: 100, offeredRate: 1380, fee: 0 }, 1500).verdict, "expensive");
  assert.equal(analyseQuote({ currency: "USD", sendAmount: 100, offeredRate: 1510, fee: 0 }, 1500).verdict, "better_than_mid_market");
  assert.throws(() => analyseQuote({ currency: "USD", sendAmount: 0, offeredRate: 1500, fee: 0 }, 1500));
});

test("addMonths clamps month ends", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-10-28", 4), "2027-02-28");
  assert.equal(addMonths("2026-12-05", 1), "2027-01-05");
});

test("voice formatting", () => {
  assert.equal(sayNgn(1_250_000), "₦1.25 million");
  assert.equal(sayNgn(350_400), "₦350,000");
  assert.equal(sayNgn(9_500), "₦9,500");
});

test("plan: essentials first, defers flexible items over budget, groups per person", () => {
  const now = new Date("2026-10-19T09:00:00Z");
  const h = sampleHousehold("test-household", now);
  const plan = planMonth(h, { today: "2026-10-19", budget: 340, midMarketRate: 2000 });
  // 3% assumed cost -> planning rate 1940
  assert.equal(plan.planningRate, 1940);
  assert.equal(plan.totalNgnDue, 150_000 + 35_000 + 450_000 + 40_000 + 120_000);
  const essentials = plan.items.filter((i) => i.priority === "essential");
  assert.ok(essentials.every((i) => i.status === "fund"));
  const gen = plan.items.find((i) => i.label === "generator repair")!;
  assert.equal(gen.status, "defer");
  assert.ok(plan.fundedSender <= 340);
  assert.deepEqual(plan.transfers.map((t) => t.member).sort(), ["Ada", "Dad", "Mum"]);
  assert.ok(plan.setAsides.some((s) => s.label === "house rent"));
  assert.match(speakPlan(plan), /generator repair/);
});

test("plan: learns real cost from logged transfers", () => {
  const h = sampleHousehold("test-household", new Date("2026-10-19T09:00:00Z"));
  h.transfers.push({
    id: "t1", at: "2026-10-01T10:00:00Z", currency: "GBP", amountSent: 100, fee: 1, offeredRate: 1980,
    midMarketRate: 2000, ngnDelivered: 198_000, hiddenCostSender: 1, obligationIds: [],
  });
  const plan = planMonth(h, { today: "2026-10-19", midMarketRate: 2000 });
  assert.equal(plan.assumedCostPct, 1.98);
  assert.match(plan.assumedCostBasis, /last 1 logged transfer/);
});
