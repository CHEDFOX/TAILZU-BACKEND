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

export async function recordKeyboardTelemetry(
  user: AuthedUser,
  input: TelemetryInput,
): Promise<void> {
  const sb = dataClientFor(user);
  // No database (DEV_SKIP_AUTH), or a static-token user whose synthetic id is
  // not a row in auth.users (the FK would reject it): the route's own log line
  // is the only record.
  if (!sb || user.id.startsWith("static-")) return;

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
