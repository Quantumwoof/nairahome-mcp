export const SENDER_CURRENCIES = ["USD", "GBP", "EUR", "CAD"] as const;
export type SenderCurrency = (typeof SENDER_CURRENCIES)[number];

export const CATEGORIES = [
  "school_fees",
  "rent",
  "allowance",
  "medical",
  "utilities",
  "food",
  "project",
  "celebration",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const RECURRENCES = ["once", "monthly", "termly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export type Priority = "essential" | "flexible";

export interface Member {
  id: string;
  name: string;
  relationship: string;
  /** Free-text payout hint such as "OPay wallet" or "GTBank". Never an account number. */
  payoutNote?: string;
}

export interface Obligation {
  id: string;
  memberId: string;
  label: string;
  category: Category;
  amountNgn: number;
  recurrence: Recurrence;
  /** ISO date YYYY-MM-DD */
  nextDue: string;
  priority: Priority;
}

export interface Transfer {
  id: string;
  /** ISO timestamp */
  at: string;
  memberId?: string;
  provider?: string;
  currency: SenderCurrency;
  amountSent: number;
  fee: number;
  offeredRate: number;
  midMarketRate: number | null;
  ngnDelivered: number;
  hiddenCostSender: number | null;
  obligationIds: string[];
  note?: string;
}

export interface RateAlert {
  id: string;
  currency: SenderCurrency;
  /** Fire when the mid-market NGN per 1 unit of currency is at or above this. */
  targetNgnPerUnit: number;
  createdAt: string;
  triggeredAt?: string;
}

export interface Household {
  id: string;
  senderCurrency: SenderCurrency;
  members: Member[];
  obligations: Obligation[];
  transfers: Transfer[];
  alerts: RateAlert[];
  /** True when the household was filled with the labelled sample data. */
  isSample?: boolean;
  createdAt: string;
  updatedAt: string;
}
