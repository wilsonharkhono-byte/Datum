import { z } from "zod";
import type { DatumClient } from "../client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PushPlatform = "ios" | "android" | "web";

export const UpsertPushTokenInput = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
  deviceName: z.string().optional(),
});

export type UpsertPushTokenInput = z.infer<typeof UpsertPushTokenInput>;

export type UpsertPushTokenResult = { ok: true } | { ok: false; error: string };

// ─── Mutation ─────────────────────────────────────────────────────────────────

/**
 * Upsert an Expo push token for the current authenticated user.
 * On conflict (token already exists), updates staff_id, platform, device_name,
 * and last_seen_at so stale records are refreshed on re-login.
 *
 * Returns a discriminated result — never throws.
 */
export async function upsertPushToken(
  supabase: DatumClient,
  input: UpsertPushTokenInput,
): Promise<UpsertPushTokenResult> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: authError?.message ?? "No authenticated user" };
  }

  const { error } = await supabase.from("push_tokens").upsert(
    {
      staff_id: user.id,
      token: input.token,
      platform: input.platform,
      device_name: input.deviceName ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
