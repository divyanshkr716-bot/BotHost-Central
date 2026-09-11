/**
 * Durable, database-backed idempotency locks.
 *
 * Serverless invocations can run concurrently (Telegram retries, double taps),
 * so "already processing" state cannot live in memory. Each lock is a row in
 * `runtime_locks` with a primary-key `key` and an `expires_at`. Acquiring is a
 * single atomic INSERT: the loser of a race gets a unique-violation and knows
 * another invocation owns the work.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LockResult = { acquired: boolean };

/**
 * Try to take a lock for `ttlSeconds`. Expired rows are reclaimed atomically by
 * a conditional update, so a crashed invocation never blocks forever.
 */
export async function acquireLock(
  db: SupabaseClient,
  botId: string,
  key: string,
  ttlSeconds: number,
): Promise<LockResult> {
  const nowIso = new Date().toISOString();
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const fullKey = `${botId}:${key}`;

  const { error } = await db
    .from("runtime_locks")
    .insert({ key: fullKey, bot_id: botId, expires_at: expires });
  if (!error) return { acquired: true };
  if (error.code !== "23505") return { acquired: true }; // never block real work on lock-store issues

  // Row exists: reclaim it only when it has expired.
  const { data: reclaimed } = await db
    .from("runtime_locks")
    .update({ expires_at: expires, created_at: nowIso })
    .eq("key", fullKey)
    .lt("expires_at", nowIso)
    .select("key")
    .maybeSingle();
  return { acquired: Boolean(reclaimed) };
}

/** Release a lock early (after the work genuinely finished). */
export async function releaseLock(db: SupabaseClient, botId: string, key: string): Promise<void> {
  await db.from("runtime_locks").delete().eq("key", `${botId}:${key}`);
}

/** Opportunistic cleanup of expired rows; safe to call often, never throws. */
export async function purgeExpiredLocks(db: SupabaseClient): Promise<void> {
  try {
    await db.from("runtime_locks").delete().lt("expires_at", new Date(Date.now() - 60_000).toISOString());
  } catch {
    /* cleanup must never break a request */
  }
}
