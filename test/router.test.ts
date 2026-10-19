import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore plain JS module shared with the browser
import { parseDate, parseMoney, route } from "../public/router.js";

const members = ["Mum", "Dad", "Ada"];
const today = new Date("2026-10-19T09:00:00Z");

test("parses a spoken transfer quote", () => {
  assert.deepEqual(parseMoney("I'm sending £300 at 1,960 with a £2 fee on Lemfi"), {
    currency: "GBP", fee: 2, offered_rate: 1960, send_amount: 300, provider: "Lemfi",
  });
  assert.deepEqual(parseMoney("I'm sending 285 pounds to Ada at 1745 with a £1.99 fee on Lemfi"), {
    currency: "GBP", fee: 1.99, offered_rate: 1745, send_amount: 285, provider: "Lemfi",
  });
  assert.deepEqual(parseMoney("fee of £2.50, sending £120 at 1700"), { currency: "GBP", fee: 2.5, offered_rate: 1700, send_amount: 120 });
  assert.equal(parseMoney("with a £1.99 fee, sending 300 pounds at 1745").send_amount, 300);
  assert.equal(parseMoney("Is 1745 a good rate for £300.").send_amount, 300);
  assert.deepEqual(parseMoney("sending 250 dollars at 1480 no fee"), { currency: "USD", fee: 0, offered_rate: 1480, send_amount: 250 });
});

test("routes the core intents", () => {
  assert.deepEqual(route("Alexa, plan my month with 600 pounds", { members, today }), { tool: "plan_month", args: { budget: 600 } });
  assert.deepEqual(route("what's the pound to naira rate", { today }), { tool: "get_naira_rate", args: { currency: "GBP" } });
  assert.equal(route("load the sample family").tool, "load_sample_family");
  assert.deepEqual(route("tell me when the pound hits 2,050 naira"), { tool: "set_rate_alert", args: { target_rate: 2050, currency: "GBP" } });
  assert.equal(route("give me a household summary").tool, "household_summary");
});

test("multi-turn: quote, then fill missing rate, then log it", () => {
  const first = route("I'm sending 300 pounds to Mum", { members });
  assert.equal(first.ask, "What naira rate is your app offering?");
  const second = route("1960, fee is 1.99, on Lemfi", { members, pending: first.pending });
  assert.equal(second.tool, "check_transfer_quote");
  assert.deepEqual(second.args, { send_amount: 300, currency: "GBP", offered_rate: 1960, fee: 1.99, provider: "Lemfi" });
  const logged = route("Done, I've sent it to Mum", { members, lastQuote: second.args });
  assert.equal(logged.tool, "log_transfer");
  assert.deepEqual(logged.args, { fee: 1.99, member_name: "Mum", amount_sent: 300, offered_rate: 1960, provider: "Lemfi" });
});

test("compare two offers", () => {
  const r = route("compare Wise at 1975 fee 0.9 and Lemfi at 1960 no fee for 400 pounds");
  assert.equal(r.tool, "compare_quotes");
  assert.equal(r.args.send_amount, 400);
  assert.deepEqual(r.args.quotes.map((q: any) => [q.provider, q.offered_rate, q.fee]), [["Wise", 1975, 0.9], ["Lemfi", 1960, 0]]);
});

test("compare with lowercase names, and 'how much have I sent' is a summary", () => {
  const r = route("compare lemfi 1740 and wise 1765 fee 3.4 for 300 pounds");
  assert.deepEqual(r.args.quotes.map((q: any) => [q.provider, q.offered_rate, q.fee]), [["Lemfi", 1740, 0], ["Wise", 1765, 3.4]]);
  assert.equal(route("Alexa, how much have I sent this year", { members }).tool, "household_summary");
});

test("adds an obligation from speech", () => {
  const r = route("Ada's school fees are 450,000 naira termly, due 28 October", { members, today });
  assert.deepEqual(r, { tool: "add_obligation", args: { member_name: "Ada", label: "school fees", amount_ngn: 450000, recurrence: "termly", priority: "essential", next_due: "2026-10-28" } });
  assert.equal(parseDate("due January 5", today), "2027-01-05");
});

test("destructive reset asks first", () => {
  const r = route("forget everything");
  assert.ok(r.ask);
  assert.deepEqual(route("yes", { pending: r.pending }), { tool: "reset_household", args: { confirm: true } });
});
