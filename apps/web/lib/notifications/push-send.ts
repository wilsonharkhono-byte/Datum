/**
 * Server-side Expo push fan-out.
 *
 * Reads push_tokens for the given recipient staff IDs using the service-role
 * admin client (the self-ownership RLS on push_tokens blocks a caller from
 * reading other users' tokens), then POSTs to the Expo push API in chunks of
 * ≤ 100 messages.
 *
 * Best-effort: errors are logged, never thrown. This must never interrupt or
 * fail the in-app notification flow.
 *
 * END-TO-END VERIFICATION NOTE:
 *   Tokens only exist once a real device has called registerPushToken() via the
 *   mobile app. Verify end-to-end by:
 *   1. Running the Expo app on a physical device (EAS projectId set in app.json)
 *   2. Logging in so the token is registered in push_tokens
 *   3. Triggering a mention / watcher event / draft action from the web app
 *   Expo push delivery can be inspected at https://expo.dev (project > Push Logs).
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ─── Expo push endpoint ───────────────────────────────────────────────────────

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpoMessage {
  to:     string;
  title:  string;
  body:   string;
  sound:  "default";
  data?:  Record<string, unknown>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fan out an Expo push notification to all registered devices for the given
 * staff IDs. Silently no-ops when:
 *  - recipientStaffIds is empty
 *  - none of the recipients have a registered push token
 *
 * Never throws — all errors are swallowed and logged.
 */
export async function sendExpoPush(
  recipientStaffIds: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (recipientStaffIds.length === 0) return;

  try {
    const admin = createSupabaseAdminClient();
    const { data: rows, error } = await admin
      .from("push_tokens")
      .select("token")
      .in("staff_id", recipientStaffIds);

    if (error) {
      console.warn("[push-send] push_tokens query failed:", error.message);
      return;
    }

    const tokens = (rows ?? []).map((r) => r.token).filter(Boolean);
    if (tokens.length === 0) return;

    const messages: ExpoMessage[] = tokens.map((token) => ({
      to:    token,
      title: payload.title,
      body:  payload.body,
      sound: "default",
      ...(payload.data ? { data: payload.data } : {}),
    }));

    // POST in chunks of ≤ 100 (Expo limit per request)
    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      const chunk = messages.slice(i, i + CHUNK_SIZE);
      try {
        await fetch(EXPO_PUSH_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body:    JSON.stringify(chunk),
        });
      } catch (fetchErr) {
        console.warn("[push-send] Expo push chunk failed:", fetchErr);
      }
    }
  } catch (err) {
    console.warn("[push-send] unexpected error:", err);
  }
}
