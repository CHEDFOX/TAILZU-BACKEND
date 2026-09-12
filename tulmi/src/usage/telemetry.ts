/**
 * Keyboard telemetry storage.
 *
 * Counters only — see supabase/migrations/0006_keyboard_telemetry.sql for why
 * the table has no free-text column at all. Writes go through the service-role
 * client (the caller's own JWT can't insert under RLS), and every failure is
 * swallowed: a keyboard is firing this in the background while someone types,
 * so telemetry must never become a user-visible error.
 */
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";

export interface TelemetryInput {
  build?: string;
  appVersion?: string;
  platform: "ios" | "android";
  /** Rollout slice per experiment flag, derived server-side. */
  buckets: Record<string, number>;
  /** Allowlisted, clamped counters. */
  counters: Record<string, number>;
  /** Wall-clock span the counters cover, so rates can be computed. */
  windowMs: number;
}

/**
 * In-memory fallback for deployments without Supabase (DEV_SKIP_AUTH local
 * runs, and static-token desktop users whose synthetic ids aren't in
 * auth.users, so an insert would violate the FK). Bounded — telemetry must
 * never become a memory leak in a long-running process.
 */
const MEM_LIMIT = 500;
const memory: Array<TelemetryInput & { userId: string; at: number }> = [];

export function memoryTelemetry(): ReadonlyArray<TelemetryInput & { userId: string; at: number }> {
  return memory;
}

export async function recordKeyboardTelemetry(
  user: AuthedUser,
  input: TelemetryInput,
): Promise<void> {
  const sb = dataClientFor(user);
  // Static-token users aren't rows in auth.users; the FK would reject them.
  if (!sb || user.id.startsWith("static-")) {
    memory.push({ ...input, userId: user.id, at: Date.now() });
    if (memory.length > MEM_LIMIT) memory.splice(0, memory.length - MEM_LIMIT);
    return;
  }

  const { error } = await sb.from("keyboard_telemetry").insert({
    user_id: user.id,
    build: input.build ?? null,
    app_version: input.appVersion ?? null,
    platform: input.platform,
    buckets: input.buckets,
    counters: input.counters,
    window_ms: input.windowMs,
  });
  if (error) {
    // Logged, not thrown — see the file header.
    console.error(`[telemetry] insert failed for ${user.id}:`, error.message);
  }
}
