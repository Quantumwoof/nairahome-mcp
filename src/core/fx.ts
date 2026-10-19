import type { SenderCurrency } from "./types.js";

export interface FxQuote {
  /** Naira per 1 unit of `currency`, mid-market reference. */
  ngnPerUnit: number;
  currency: SenderCurrency;
  /** Where the number came from. Always shown to the user. */
  source: string;
  /** When the source last updated this rate (ISO). */
  asOf: string;
  /** "live" = fetched from the public rate API, "cached" = served from memory, "demo" = labelled offline fixture. */
  mode: "live" | "cached" | "demo";
}

export interface FxProvider {
  getRate(currency: SenderCurrency): Promise<FxQuote>;
}

const SOURCE = "ExchangeRate-API open access (open.er-api.com), mid-market reference";
const CACHE_MS = 30 * 60 * 1000;

/**
 * Live mid-market rates from ExchangeRate-API's free open endpoint (no key, attribution required).
 * This is a reference rate. Money transfer apps add a markup on top of it; NairaHome's job is to
 * show that markup, never to invent a provider's price.
 */
export class LiveFx implements FxProvider {
  private cache = new Map<string, { at: number; quote: FxQuote }>();
  constructor(
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  async getRate(currency: SenderCurrency): Promise<FxQuote> {
    const hit = this.cache.get(currency);
    if (hit && this.now() - hit.at < CACHE_MS) return { ...hit.quote, mode: "cached" };
    const res = await this.fetchImpl(`https://open.er-api.com/v6/latest/${currency}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new FxUnavailableError(`rate API answered HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: string;
      time_last_update_unix?: number;
      rates?: Record<string, number>;
    };
    const ngn = body.rates?.NGN;
    if (body.result !== "success" || typeof ngn !== "number" || !(ngn > 0)) {
      throw new FxUnavailableError("rate API returned no NGN rate");
    }
    const quote: FxQuote = {
      ngnPerUnit: round(ngn, 2),
      currency,
      source: SOURCE,
      asOf: new Date((body.time_last_update_unix ?? this.now() / 1000) * 1000).toISOString(),
      mode: "live",
    };
    this.cache.set(currency, { at: this.now(), quote });
    return quote;
  }
}

/**
 * Clearly labelled demo rates for offline development and tests. Every answer built on these says so.
 * Enabled only by FX_MODE=demo; production never falls back to it silently.
 */
export const DEMO_RATES: Record<SenderCurrency, number> = {
  USD: 1500,
  GBP: 2000,
  EUR: 1700,
  CAD: 1100,
};

export class DemoFx implements FxProvider {
  async getRate(currency: SenderCurrency): Promise<FxQuote> {
    return {
      ngnPerUnit: DEMO_RATES[currency],
      currency,
      source: "DEMO MODE fixture rate (not a real market rate)",
      asOf: "1970-01-01T00:00:00.000Z",
      mode: "demo",
    };
  }
}

export class FxUnavailableError extends Error {
  constructor(detail: string) {
    super(`Live naira rate is unavailable right now (${detail}).`);
  }
}

export function fxFromEnv(env = process.env): FxProvider {
  return env.FX_MODE === "demo" ? new DemoFx() : new LiveFx();
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
