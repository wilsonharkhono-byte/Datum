/**
 * Server-side WhatsApp (Meta Cloud API) template fan-out.
 *
 * Env-guarded: with WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID unset,
 * every call is a silent no-op (dev/CI safe until Wilson completes Meta setup).
 *
 * Reads staff.whatsapp_number for the given recipient staff IDs using the
 * service-role admin client (passed in by the caller — mirrors the cron
 * route's own admin usage rather than constructing a second client), skips
 * recipients with no usable number, applies a same-day dedupe check against
 * whatsapp_messages when a dedupeKey is supplied, then POSTs a template
 * message per recipient to the Graph API and records the attempt.
 *
 * Best-effort: errors are logged, never thrown. This must never interrupt or
 * fail the in-app notification / Expo push flow.
 *
 * No webhook in this phase — delivery status (`sent` vs `delivered`/`read`)
 * is not updated after the initial POST; only the send attempt is recorded.
 */

import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ─── Meta Cloud API endpoint ──────────────────────────────────────────────────

const WHATSAPP_API_VERSION = "v23.0";

// ─── Templates ────────────────────────────────────────────────────────────────

export const WHATSAPP_TEMPLATES = {
  readinessReminder: "pengingat_kesiapan",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

interface SendWhatsAppOpts {
  template: string;
  bodyParams: string[];
  dedupeKey?: string;
}

// ─── Phone normalization ──────────────────────────────────────────────────────

/**
 * Normalize a raw phone number into the digits-only, country-code-prefixed
 * form the Graph API expects (e.g. "6281234567890").
 *
 * Rules:
 *  - Strip spaces, dashes, and parens.
 *  - Strip a leading "+".
 *  - "08…" → "628…" (local Indonesian mobile format).
 *  - "62…" is kept as-is.
 *  - Any other prefix, or non-numeric / too-short input → null.
 *
 * Exported for unit testing.
 */
export function normalizeWhatsAppNumber(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, "").replace(/^\+/, "");

  if (!/^\d+$/.test(cleaned) || cleaned.length < 9) return null;

  if (cleaned.startsWith("62")) return cleaned;
  if (cleaned.startsWith("08")) return `62${cleaned.slice(1)}`;

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp template message to the given staff IDs' registered
 * whatsapp_number. Silently no-ops when:
 *  - WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID env vars are unset
 *  - staffIds is empty
 *  - a recipient has no usable (normalizable) whatsapp_number
 *  - dedupeKey is supplied and a matching whatsapp_messages row already
 *    exists from earlier today
 *
 * Never throws — all errors are swallowed and logged.
 */
export async function sendWhatsAppTemplate(
  admin: AdminClient,
  staffIds: string[],
  opts: SendWhatsAppOpts,
): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) return;
  if (staffIds.length === 0) return;

  try {
    const { data: rows, error } = await admin
      .from("staff")
      .select("id, whatsapp_number")
      .in("id", staffIds);

    if (error) {
      console.warn("[whatsapp-send] staff query failed:", error.message);
      return;
    }

    const recipients = (rows ?? [])
      .map((r) => ({ staffId: r.id, phone: r.whatsapp_number ? normalizeWhatsAppNumber(r.whatsapp_number) : null }))
      .filter((r): r is { staffId: string; phone: string } => Boolean(r.phone));

    if (recipients.length === 0) return;

    if (opts.dedupeKey) {
      const alreadySent = await wasSentToday(admin, opts.dedupeKey);
      if (alreadySent) return;
    }

    for (const { staffId, phone } of recipients) {
      await sendOne(admin, { staffId, phone, template: opts.template, bodyParams: opts.bodyParams, accessToken, phoneNumberId });
    }
  } catch (err) {
    console.warn("[whatsapp-send] unexpected error:", err);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** True when a whatsapp_messages row with this dedupe_key was created today (server date). */
async function wasSentToday(admin: AdminClient, dedupeKey: string): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await admin
    .from("whatsapp_messages")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    console.warn("[whatsapp-send] dedupe check failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Send a single template message and record the attempt in whatsapp_messages. */
async function sendOne(
  admin: AdminClient,
  args: {
    staffId: string;
    phone: string;
    template: string;
    bodyParams: string[];
    accessToken: string;
    phoneNumberId: string;
  },
): Promise<void> {
  const { staffId, phone, template, bodyParams, accessToken, phoneNumberId } = args;

  const body = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: template,
      language: { code: "id" },
      components: [
        { type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) },
      ],
    },
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg = json?.error?.message ?? `HTTP ${res.status}`;
      console.warn(`[whatsapp-send] send failed for staff ${staffId}:`, errMsg);
      await insertAttempt(admin, { staffId, phone, template, bodyParams, status: "failed", error: errMsg });
      return;
    }

    const wamid = json?.messages?.[0]?.id ?? null;
    await insertAttempt(admin, { staffId, phone, template, bodyParams, status: "sent", wamid });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[whatsapp-send] fetch failed for staff ${staffId}:`, msg);
    await insertAttempt(admin, { staffId, phone, template, bodyParams, status: "failed", error: msg });
  }
}

/** Insert a whatsapp_messages row for a single send attempt. Best-effort — logs on failure. */
async function insertAttempt(
  admin: AdminClient,
  args: {
    staffId: string;
    phone: string;
    template: string;
    bodyParams: string[];
    status: "sent" | "failed";
    wamid?: string | null;
    error?: string;
  },
): Promise<void> {
  const { staffId, phone, template, bodyParams, status, wamid, error } = args;

  const { error: insertErr } = await admin.from("whatsapp_messages").insert({
    recipient_kind: "staff",
    staff_id: staffId,
    phone,
    template_name: template,
    payload: { bodyParams },
    status,
    ...(wamid ? { wamid } : {}),
    ...(error ? { error } : {}),
  });

  if (insertErr) {
    console.warn(`[whatsapp-send] whatsapp_messages insert failed for staff ${staffId}:`, insertErr.message);
  }
}
