import { addMonths, isoDate } from "./money.js";
import type { Household } from "./types.js";

/**
 * A clearly labelled sample family, dated relative to today, so a judge can try the
 * planner in one click. Nothing here comes from a real person or a real account.
 */
export function sampleHousehold(id: string, now = new Date()): Household {
  const today = isoDate(now);
  const ym = today.slice(0, 7);
  const inMonth = (day: number) => {
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    return `${ym}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const at = now.toISOString();
  return {
    id,
    senderCurrency: "GBP",
    isSample: true,
    createdAt: at,
    updatedAt: at,
    members: [
      { id: "m_mum", name: "Mum", relationship: "mother", payoutNote: "OPay wallet" },
      { id: "m_dad", name: "Dad", relationship: "father", payoutNote: "Moniepoint" },
      { id: "m_ada", name: "Ada", relationship: "sister, university student", payoutNote: "GTBank" },
    ],
    obligations: [
      { id: "o_upkeep", memberId: "m_mum", label: "monthly upkeep", category: "allowance", amountNgn: 150_000, recurrence: "monthly", nextDue: inMonth(25), priority: "essential" },
      { id: "o_meds", memberId: "m_dad", label: "blood pressure medication", category: "medical", amountNgn: 35_000, recurrence: "monthly", nextDue: inMonth(22), priority: "essential" },
      { id: "o_fees", memberId: "m_ada", label: "school fees", category: "school_fees", amountNgn: 450_000, recurrence: "termly", nextDue: inMonth(28), priority: "essential" },
      { id: "o_data", memberId: "m_ada", label: "data and transport", category: "allowance", amountNgn: 40_000, recurrence: "monthly", nextDue: inMonth(30), priority: "flexible" },
      { id: "o_gen", memberId: "m_dad", label: "generator repair", category: "utilities", amountNgn: 120_000, recurrence: "once", nextDue: inMonth(31), priority: "flexible" },
      { id: "o_rent", memberId: "m_mum", label: "house rent", category: "rent", amountNgn: 1_200_000, recurrence: "yearly", nextDue: addMonths(`${ym}-05`, 3), priority: "essential" },
      { id: "o_xmas", memberId: "m_mum", label: "Christmas for the family", category: "celebration", amountNgn: 300_000, recurrence: "yearly", nextDue: `${now.getUTCMonth() === 11 && now.getUTCDate() > 20 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()}-12-20`, priority: "flexible" },
    ],
    transfers: [],
    alerts: [],
  };
}
