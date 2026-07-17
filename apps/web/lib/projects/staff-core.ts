/**
 * staff-core.ts
 *
 * Server-only module (NOT "use server") — can export types + non-async helpers
 * freely. Contains the single canonical implementation of staff creation:
 *   auth.admin.createUser + staff row insert + optional project_staff assignment.
 *
 * Both callers (the FormData server action in staff-mutations.ts and the JSON
 * API route in app/api/staff/create/route.ts) delegate to this after handling
 * their own auth/authz and input parsing.
 *
 * The service-role admin client is created by the caller and passed in —
 * this module never instantiates it directly so it cannot accidentally reach
 * the client bundle.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CreateStaffInputType } from "@datum/core";

// Re-export the type alias so callers can reference it without importing admin.ts.
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type { CreateStaffInputType };

export type CreateStaffResult =
  | { ok: true; staffId: string; email: string }
  | { ok: false; error: string };

/** Lowercase first name stripped to [a-z0-9_], letter-start guaranteed,
    truncated so a dedupe suffix still fits the 31-char handle limit. */
function baseHandleFromName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const clean = first.replace(/[^a-z0-9_]/g, "");
  const letterStart = /^[a-z]/.test(clean) ? clean : `staf${clean}`;
  return letterStart.slice(0, 24) || "staf";
}

/** Pick the first free handle: base, base2, base3 … (mirrors the migration's
    backfill numbering). Reads with the admin client so RLS can't hide rows. */
async function generateUniqueHandle(
  admin: AdminClient,
  fullName: string,
): Promise<string> {
  const base = baseHandleFromName(fullName);
  const { data } = await admin
    .from("staff")
    .select("handle")
    .like("handle", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.handle));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }
  return `${base}${Math.floor(Math.random() * 1_000_000)}`;
}

/**
 * Core staff-creation logic: auth.admin.createUser + staff insert +
 * optional project_staff assignment. Takes the admin client + validated
 * input as params — no FormData, no auth/authz (callers handle those).
 *
 * Returns { ok: true, staffId, email } on success, { ok: false, error } on failure.
 * Rolls back the auth user if the staff insert fails.
 */
export async function createStaffWithPasswordCore(
  admin: AdminClient,
  input: CreateStaffInputType,
): Promise<CreateStaffResult> {
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (authErr || !authData.user) {
    if (authErr?.message?.toLowerCase().includes("already")) {
      return { ok: false, error: "Email ini sudah terdaftar di Supabase Auth" };
    }
    return { ok: false, error: authErr?.message ?? "Gagal membuat akun auth" };
  }

  const newUserId = authData.user.id;
  const handle = await generateUniqueHandle(admin, input.fullName);

  const { error: staffErr } = await admin.from("staff").insert({
    id:           newUserId,
    full_name:    input.fullName,
    role:         input.role,
    email:        input.email,
    handle,
    cost_visible: input.costVisible ?? false,
    active:       true,
  });

  if (staffErr) {
    // Roll back the auth user so we don't leave an orphan
    await admin.auth.admin.deleteUser(newUserId);
    if (staffErr.code === "23505") {
      return { ok: false, error: "Email ini sudah terdaftar di tabel staf" };
    }
    return { ok: false, error: `Gagal membuat staf: ${staffErr.message}` };
  }

  if (input.projectId && input.roleOnProject) {
    const today = new Date().toISOString().slice(0, 10);
    const { error: psErr } = await admin.from("project_staff").insert({
      project_id:      input.projectId,
      staff_id:        newUserId,
      role_on_project: input.roleOnProject,
      cost_visible:    input.costVisible ?? false,
      active_from:     today,
    });
    if (psErr) {
      return {
        ok: false,
        error: `Staf dibuat tapi gagal ditambahkan ke proyek: ${psErr.message}`,
      };
    }
  }

  return { ok: true, staffId: newUserId, email: input.email };
}
