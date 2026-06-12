"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RELATIONS = ["depends_on", "blocks", "related_to", "supersedes"] as const;

export type CardLinkResult = { ok: true } | { ok: false; error: string };

// ─── createCardLink ───────────────────────────────────────────────────────────

const CreateLinkInput = z.object({
  fromCardId:  z.string().uuid(),
  toCardId:    z.string().uuid(),
  relation:    z.enum(RELATIONS),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export async function createCardLink(formData: FormData): Promise<CardLinkResult> {
  let input;
  try {
    input = CreateLinkInput.parse({
      fromCardId:  formData.get("fromCardId"),
      toCardId:    formData.get("toCardId"),
      relation:    formData.get("relation"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  if (input.fromCardId === input.toCardId) {
    return { ok: false, error: "Kartu tidak bisa ditautkan ke dirinya sendiri" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  // Duplicate guard — the pair+relation already linked in either direction
  // counts as the same tautan from the user's point of view.
  const { data: existing, error: dupErr } = await supabase
    .from("card_links")
    .select("from_card_id")
    .eq("relation", input.relation)
    .or(
      `and(from_card_id.eq.${input.fromCardId},to_card_id.eq.${input.toCardId}),` +
      `and(from_card_id.eq.${input.toCardId},to_card_id.eq.${input.fromCardId})`,
    )
    .limit(1);
  if (dupErr) return { ok: false, error: dupErr.message };
  if ((existing ?? []).length > 0) {
    return { ok: false, error: "Tautan sudah ada" };
  }

  const { error } = await supabase.from("card_links").insert({
    from_card_id:        input.fromCardId,
    to_card_id:          input.toCardId,
    relation:            input.relation,
    created_by_staff_id: user.id,
  });
  if (error) {
    // Composite-PK conflict — raced a concurrent insert of the same link.
    if (error.code === "23505") return { ok: false, error: "Tautan sudah ada" };
    return { ok: false, error: error.message };
  }

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

// ─── deleteCardLink ───────────────────────────────────────────────────────────
// card_links has no surrogate id (composite PK from/to/relation), so deletion
// is addressed by the triple. NOTE: RLS currently defines no DELETE policy on
// card_links (see 20260601000004_cards_rls_fixes.sql — "no delete"), so under
// RLS this removes 0 rows; we detect that and surface a clear error instead
// of silently succeeding.

const DeleteLinkInput = z.object({
  fromCardId:  z.string().uuid(),
  toCardId:    z.string().uuid(),
  relation:    z.enum(RELATIONS),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export async function deleteCardLink(formData: FormData): Promise<CardLinkResult> {
  let input;
  try {
    input = DeleteLinkInput.parse({
      fromCardId:  formData.get("fromCardId"),
      toCardId:    formData.get("toCardId"),
      relation:    formData.get("relation"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const { data: deleted, error } = await supabase
    .from("card_links")
    .delete()
    .eq("from_card_id", input.fromCardId)
    .eq("to_card_id", input.toCardId)
    .eq("relation", input.relation)
    .select("from_card_id");
  if (error) return { ok: false, error: error.message };
  if ((deleted ?? []).length === 0) {
    return {
      ok: false,
      error: "Tautan tidak dapat dihapus — kebijakan akses belum mengizinkan penghapusan",
    };
  }

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

// ─── searchProjectCards ───────────────────────────────────────────────────────
// Client-initiated read for the add-link form. The codebase has no route
// handlers for reads — client components call server actions — so the search
// lives here in the "use server" file alongside the link mutations.

const SearchCardsInput = z.object({
  projectId:     z.string().uuid(),
  term:          z.string().min(1).max(120),
  excludeCardId: z.string().uuid(),
});

export type CardSearchHit = { id: string; slug: string; title: string };
export type SearchCardsResult =
  | { ok: true; results: CardSearchHit[] }
  | { ok: false; error: string };

export async function searchProjectCards(formData: FormData): Promise<SearchCardsResult> {
  let input;
  try {
    input = SearchCardsInput.parse({
      projectId:     formData.get("projectId"),
      term:          formData.get("term"),
      excludeCardId: formData.get("excludeCardId"),
    });
  } catch {
    return { ok: false, error: "Pencarian tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const pattern = `%${input.term.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const { data, error } = await supabase
    .from("cards")
    .select("id, slug, title")
    .eq("project_id", input.projectId)
    .neq("id", input.excludeCardId)
    .ilike("title", pattern)
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(8);
  if (error) return { ok: false, error: error.message };

  return { ok: true, results: (data ?? []) as CardSearchHit[] };
}
