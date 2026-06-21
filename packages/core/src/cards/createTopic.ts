import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const CreateTopicInput = z.object({
  projectId: z.string().uuid(),
  name:      z.string().min(1).max(120),
});

export type CreateTopicInputType = z.infer<typeof CreateTopicInput>;

// ─── Result ──────────────────────────────────────────────────────────────────

export type CreateTopicResult =
  | { ok: true; topicId: string }
  | { ok: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Derive a project-unique topic code from the column name. topics.code is
// `not null` + `unique(project_id, code)`, but the board UI only asks for a
// human name — so we slug the name into an uppercase code and disambiguate
// with a numeric suffix the same way createCard does for slugs.
export function toTopicCode(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "KOLOM"
  );
}

// ─── Mutation ────────────────────────────────────────────────────────────────

// Any project member may add a column — the topics_insert RLS policy gates on
// project membership, not role. We only need a signed-in staff row to stamp
// created_by_staff_id.
export async function createTopic(
  supabase: SupabaseClient<Database>,
  input: CreateTopicInputType,
): Promise<CreateTopicResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const base = toTopicCode(input.name);
  let code = base;
  for (let i = 2; i < 100; i++) {
    const { data: existing } = await supabase
      .from("topics")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("code", code)
      .maybeSingle();
    if (!existing) break;
    code = `${base}-${i}`.slice(0, 40);
  }

  // Append to the end of the board.
  const { data: maxRow } = await supabase
    .from("topics")
    .select("sort_order")
    .eq("project_id", input.projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? -1) + 1;

  const { data: inserted, error } = await supabase
    .from("topics")
    .insert({
      project_id:          input.projectId,
      code,
      name:                input.name,
      topic_type:          "general",
      sort_order:          nextSort,
      created_by_staff_id: user.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Kode kolom "${code}" sudah ada di proyek ini` };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, topicId: inserted.id };
}
