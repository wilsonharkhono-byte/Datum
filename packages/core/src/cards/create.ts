import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const CreateCardInput = z.object({
  projectId: z.string().uuid(),
  topicId:   z.string().uuid(),
  title:     z.string().min(1).max(120),
});

export type CreateCardInputType = z.infer<typeof CreateCardInput>;

// ─── Result ──────────────────────────────────────────────────────────────────

export type CreateCardResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function toSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "kartu"
  );
}

// ─── Mutation ────────────────────────────────────────────────────────────────

export async function createCard(
  supabase: SupabaseClient<Database>,
  input: CreateCardInputType,
): Promise<CreateCardResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const base = toSlug(input.title);
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const { data: existing } = await supabase
      .from("cards")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${base}-${i}`;
  }

  const { data: inserted, error } = await supabase
    .from("cards")
    .insert({
      project_id:          input.projectId,
      topic_id:            input.topicId,
      title:               input.title,
      slug,
      created_by_staff_id: user.id,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "Gagal membuat kartu" };

  return { ok: true, slug, id: inserted.id };
}
