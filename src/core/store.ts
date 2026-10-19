import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Household, SenderCurrency } from "./types.js";

export interface HouseholdStore {
  readonly kind: string;
  /** True when data survives restarts and new sessions. */
  readonly durable: boolean;
  load(id: string): Promise<Household | null>;
  save(h: Household): Promise<void>;
}

export const HOUSEHOLD_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function assertHouseholdId(id: string): string {
  if (!HOUSEHOLD_ID.test(id)) throw new Error("household id must be 8-64 letters, digits, '-' or '_'");
  return id;
}

export function emptyHousehold(id: string, senderCurrency: SenderCurrency = "GBP", now = new Date()): Household {
  const at = now.toISOString();
  return { id, senderCurrency, members: [], obligations: [], transfers: [], alerts: [], createdAt: at, updatedAt: at };
}

export class MemoryStore implements HouseholdStore {
  readonly kind = "memory";
  readonly durable = false;
  private map = new Map<string, string>();
  async load(id: string) {
    const raw = this.map.get(id);
    return raw ? (JSON.parse(raw) as Household) : null;
  }
  async save(h: Household) {
    this.map.set(h.id, JSON.stringify(h));
  }
}

/** One JSON file per household. Default for self-hosting. */
export class FileStore implements HouseholdStore {
  readonly kind = "file";
  readonly durable = true;
  constructor(private dir: string) {}
  private path(id: string) {
    return join(this.dir, `${assertHouseholdId(id)}.json`);
  }
  async load(id: string) {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8")) as Household;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async save(h: Household) {
    await mkdir(this.dir, { recursive: true });
    const tmp = this.path(h.id) + ".tmp";
    await writeFile(tmp, JSON.stringify(h, null, 2));
    await rename(tmp, this.path(h.id));
  }
}

/** Private Vercel Blob objects, used by the hosted serverless deployment. */
export class BlobStore implements HouseholdStore {
  readonly kind = "vercel-blob";
  readonly durable = true;
  private key(id: string) {
    return `households/${assertHouseholdId(id)}.json`;
  }
  async load(id: string) {
    const { get } = await import("@vercel/blob");
    const res = await get(this.key(id), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return JSON.parse(await new Response(res.stream).text()) as Household;
  }
  async save(h: Household) {
    const { put } = await import("@vercel/blob");
    await put(this.key(h.id), JSON.stringify(h), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
    });
  }
}

export function storeFromEnv(env = process.env): HouseholdStore {
  if (env.STORE === "memory") return new MemoryStore();
  if (env.BLOB_READ_WRITE_TOKEN || env.STORE === "blob") return new BlobStore();
  if (env.VERCEL) return new MemoryStore();
  return new FileStore(env.DATA_DIR ?? join(process.cwd(), "data"));
}
