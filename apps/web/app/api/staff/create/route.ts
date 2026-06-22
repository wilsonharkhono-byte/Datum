/**
 * POST /api/staff/create
 *
 * Thin HTTP wrapper around the staff-creation logic. Accepts JSON (not FormData)
 * so that the mobile app can call it with a Bearer token.
 *
 * Auth flow:
 *   1. createSupabaseClientForRequest → handles both cookie (web) and Bearer
 *      (mobile) without ever shipping the service-role key to the client.
 *   2. getCurrentStaff(supabase) → 401 if not signed-in / no staff row.
 *   3. canManageAccess(staff)    → 403 if designer / pic / etc.
 *   4. CreateStaffInput.safeParse(body) → 400 on bad shape.
 *   5. Role-escalation check (only principals can mint principal/admin).
 *   6. admin.auth.admin.createUser + staff insert (+ optional project_staff).
 *   7. Return { ok: true, staffId, email, tempPassword } — caller shows
 *      tempPassword to the admin once so they can share it via WhatsApp.
 *
 * The service-role admin client NEVER leaves this file.
 */

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createSupabaseClientForRequest } from "@/lib/supabase/from-request";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentStaff, canManageAccess } from "@datum/core";
import { CreateStaffInput } from "@datum/core";

export async function POST(req: Request) {
  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const supabase = await createSupabaseClientForRequest(req);
  const staff = await getCurrentStaff(supabase);

  if (!staff) {
    return NextResponse.json(
      { ok: false, error: "Sesi tidak ditemukan. Silakan masuk kembali." },
      { status: 401 },
    );
  }

  // ── 2. Authorise ────────────────────────────────────────────────────────────
  if (!canManageAccess(staff)) {
    return NextResponse.json(
      { ok: false, error: "Hanya principal atau admin yang bisa membuat staf baru." },
      { status: 403 },
    );
  }

  // ── 3. Parse + validate body ────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body permintaan harus berformat JSON." },
      { status: 400 },
    );
  }

  const parsed = CreateStaffInput.safeParse(rawBody);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const firstMessage =
      parsed.error.errors[0]?.message ?? "Data tidak valid.";
    return NextResponse.json(
      { ok: false, error: firstMessage, fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // ── 4. Role-escalation guard ───────────────────────────────────────────────
  if (
    (input.role === "principal" || input.role === "admin") &&
    staff.role !== "principal"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Hanya principal yang bisa membuat akun principal atau admin.",
      },
      { status: 403 },
    );
  }

  // ── 5. Create auth user + staff row (service-role; never touches client) ───
  const admin = createSupabaseAdminClient();

  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (authErr || !authData.user) {
    if (authErr?.message?.toLowerCase().includes("already")) {
      return NextResponse.json(
        { ok: false, error: "Email ini sudah terdaftar di Supabase Auth." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: authErr?.message ?? "Gagal membuat akun auth." },
      { status: 500 },
    );
  }

  const newUserId = authData.user.id;

  // Insert staff row
  const { error: staffErr } = await admin.from("staff").insert({
    id: newUserId,
    full_name: input.fullName,
    role: input.role,
    email: input.email,
    cost_visible: input.costVisible ?? false,
    active: true,
  });

  if (staffErr) {
    // Roll back auth user to avoid orphan
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { ok: false, error: `Gagal membuat staf: ${staffErr.message}` },
      { status: 500 },
    );
  }

  // Optionally assign to a project
  if (input.projectId && input.roleOnProject) {
    const today = new Date().toISOString().slice(0, 10);
    const { error: psErr } = await admin.from("project_staff").insert({
      project_id: input.projectId,
      staff_id: newUserId,
      role_on_project: input.roleOnProject,
      cost_visible: input.costVisible ?? false,
      active_from: today,
    });
    if (psErr) {
      return NextResponse.json(
        {
          ok: false,
          error: `Staf dibuat tapi gagal ditambahkan ke proyek: ${psErr.message}`,
        },
        { status: 500 },
      );
    }
  }

  // ── 6. Return result (temp password shown once to the admin) ───────────────
  return NextResponse.json({
    ok: true,
    staffId: newUserId,
    email: input.email,
    tempPassword: input.password,
  });
}
