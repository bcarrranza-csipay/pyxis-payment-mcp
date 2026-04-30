/**
 * redis-store.ts
 *
 * Optional Redis persistence layer for simulator and mock modes.
 *
 * When REDIS_URL is set, every transaction write is mirrored to Redis so
 * history survives server restarts and app close/reopen.
 *
 * When REDIS_URL is NOT set (or Redis is unreachable), the module is a
 * silent no-op — the in-memory PyxisState continues to work as before.
 *
 * Key schema:
 *   tx:<transactionId>          → JSON string of Transaction
 *   txlist:<terminalId>         → Redis List of transactionIds (newest first)
 *   txlist:__all__              → Redis List of ALL transactionIds (newest first)
 *
 * Only used for PYXIS_MODE=simulator and PYXIS_MODE=mock.
 * PYXIS_MODE=live is untouched — the real Pyxis sandbox owns persistence.
 */

import { Redis } from "ioredis";
import type { Transaction } from "./state.js";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let client: Redis | null = null;
let connectionFailed = false;

function getClient(): Redis | null {
  if (connectionFailed) return null;
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  // live mode never uses Redis
  const mode = process.env.PYXIS_MODE ?? "simulator";
  if (mode === "live") return null;

  try {
    client = new Redis(url, {
      // TLS required for ElastiCache Serverless (rediss:// URLs)
      tls: url.startsWith("rediss://") ? {} : undefined,
      // Fail fast on first connect — don't block the server startup
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    client.on("error", (err: Error) => {
      // Log once, then mark as failed so we stop trying
      if (!connectionFailed) {
        console.error("[redis-store] Redis unavailable — falling back to in-memory:", err.message);
        connectionFailed = true;
        client = null;
      }
    });

    client.on("connect", () => {
      console.log("[redis-store] Connected to Redis:", url.replace(/:\/\/.*@/, "://***@"));
    });

    // Kick off the lazy connection
    client.connect().catch(() => {
      connectionFailed = true;
      client = null;
    });

    return client;
  } catch (err: any) {
    console.error("[redis-store] Failed to initialise Redis client:", err.message);
    connectionFailed = false; // allow retry on next call
    return null;
  }
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/** Transaction → Redis-safe JSON (Dates become ISO strings) */
function serialise(tx: Transaction): string {
  return JSON.stringify({
    ...tx,
    createdAt: tx.createdAt.toISOString(),
    settledAt: tx.settledAt?.toISOString() ?? null,
  });
}

/** Redis JSON → Transaction (ISO strings back to Dates) */
function deserialise(raw: string): Transaction {
  const obj = JSON.parse(raw);
  return {
    ...obj,
    createdAt: new Date(obj.createdAt),
    settledAt: obj.settledAt ? new Date(obj.settledAt) : undefined,
  } as Transaction;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a transaction to Redis.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export async function redisSave(tx: Transaction): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    const key = `tx:${tx.transactionId}`;
    const json = serialise(tx);
    // Store the transaction JSON
    await redis.set(key, json);
    // Maintain per-terminal list (newest first via LPUSH)
    await redis.lpush(`txlist:${tx.terminalId}`, tx.transactionId);
    // Maintain global list
    await redis.lpush("txlist:__all__", tx.transactionId);
  } catch (err: any) {
    // Silent — in-memory state is still the source of truth
    console.error("[redis-store] redisSave error:", err.message);
  }
}

/**
 * Update an existing transaction in Redis (e.g. status change on void/refund).
 * Fire-and-forget.
 */
export async function redisUpdate(tx: Transaction): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(`tx:${tx.transactionId}`, serialise(tx));
  } catch (err: any) {
    console.error("[redis-store] redisUpdate error:", err.message);
  }
}

/**
 * Load all transactions from Redis into the in-memory state on startup.
 * Called once when the server starts. Returns the list of transactions loaded.
 */
export async function redisLoadAll(): Promise<Transaction[]> {
  const redis = getClient();
  if (!redis) return [];
  try {
    // Wait for connection to be ready (up to 3s)
    await new Promise<void>((resolve) => {
      if (redis.status === "ready") { resolve(); return; }
      const timeout = setTimeout(() => resolve(), 3000);
      redis.once("ready", () => { clearTimeout(timeout); resolve(); });
    });

    const ids = await redis.lrange("txlist:__all__", 0, -1);
    if (ids.length === 0) return [];

    // Batch fetch all transaction JSONs
    const pipeline = redis.pipeline();
    ids.forEach((id: string) => pipeline.get(`tx:${id}`));
    const results = await pipeline.exec();

    const transactions: Transaction[] = [];
    if (results) {
      for (const [err, raw] of results) {
        if (!err && raw && typeof raw === "string") {
          try {
            transactions.push(deserialise(raw));
          } catch { /* skip malformed entries */ }
        }
      }
    }
    console.log(`[redis-store] Loaded ${transactions.length} transactions from Redis`);
    return transactions;
  } catch (err: any) {
    console.error("[redis-store] redisLoadAll error:", err.message);
    return [];
  }
}

/**
 * Check whether Redis is currently connected.
 */
export function redisIsConnected(): boolean {
  return !!client && !connectionFailed && client.status === "ready";
}
