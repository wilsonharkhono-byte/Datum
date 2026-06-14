"use client";
import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCard } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";
import { subscribeToProjectChanges } from "@/lib/cards/realtime";
import type { CardPayload } from "@/app/api/card/[code]/[slug]/route";
import type { CardAttachment, Staff } from "@datum/db";
import { Timeline } from "@/components/board/Timeline";
import { CommentsSection } from "@/components/board/CommentsSection";
import { CardMembers } from "@/components/board/CardMembers";

type StaffLite = Pick<Staff, "id" | "full_name" | "role">;

/** Client wrapper for the dynamic card sections. The timeline events, comments,
    and members are sourced from the cached card query (useCard) so the screen
    repaints instantly on revisit; the static editing affordances (header, add
    event, move, areas, links) are server-rendered and passed in as node slots
    so they stay RSC. A single realtime subscription invalidates the card query
    on change — this replaces the per-section router.refresh() that Timeline and
    CommentsRefresher used to do, so the cache-backed sections actually update. */
export function CardDetailClient({
  code,
  slug,
  urlSlug,
  initialCard,
  projectId,
  projectCode,
  currentStaffId,
  attachmentsByEvent,
  candidates,
  header,
  addEvent,
  moveControl,
  areas,
  links,
}: {
  /** Card-query code (uppercase project code) — identity for useCard/keys.card. */
  code: string;
  /** Card slug — identity for useCard/keys.card (the card's DB slug). */
  slug: string;
  /** The page's URL `slug` segment, threaded to the comment/member sections so
      their server-action revalidatePath matches the actual visited URL. */
  urlSlug: string;
  initialCard: CardPayload;
  projectId: string;
  /** Uppercase project_code, passed to Timeline (mirrors the prior page wiring). */
  projectCode: string;
  currentStaffId: string | null;
  attachmentsByEvent: Map<string, CardAttachment[]>;
  candidates: StaffLite[];
  // Server-rendered sections passed through unchanged (kept as RSC).
  header: ReactNode;
  addEvent: ReactNode;
  moveControl: ReactNode;
  areas: ReactNode;
  links: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data } = useCard(code, slug, initialCard);
  const card = data ?? initialCard;

  useEffect(() => {
    return subscribeToProjectChanges(projectId, () => {
      queryClient.invalidateQueries({ queryKey: keys.card(code, slug) });
    });
  }, [projectId, code, slug, queryClient]);

  const members = card.members.map((m) => ({
    staff_id: m.staff_id,
    role: m.role,
    staff: m.staff,
  }));

  return (
    <div className="grid gap-0 md:grid-cols-[1fr_280px]">
      {/* Main column — the focused content */}
      <div className="border-b border-[var(--border)] px-4 py-4 md:border-b-0 md:border-r md:px-6 md:py-5">
        {header}
        <div className="mt-5">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
            Tambah aktivitas
          </h2>
          {addEvent}
        </div>
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
            Timeline aktivitas
          </h2>
          <Timeline
            events={card.events}
            attachmentsByEvent={attachmentsByEvent}
            projectCode={projectCode}
            cardSlug={slug}
          />
        </div>
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
            Diskusi
          </h2>
          <CommentsSection
            cardId={card.card.id}
            projectId={projectId}
            projectCode={urlSlug}
            cardSlug={slug}
            cardCode={code}
            cardQuerySlug={slug}
            currentStaffId={currentStaffId}
            comments={card.comments}
          />
        </div>
      </div>

      {/* Sidebar — Trello-style actions/members panel */}
      <aside className="bg-[var(--surface-alt)] px-4 py-4 md:py-5">
        <div>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
            Pindah kolom
          </h2>
          {moveControl}
        </div>
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
            Anggota kartu
          </h2>
          <CardMembers
            cardId={card.card.id}
            projectCode={urlSlug}
            cardSlug={slug}
            cardCode={code}
            cardQuerySlug={slug}
            members={members}
            candidates={candidates}
          />
        </div>
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
            Areas terkait
          </h2>
          {areas}
        </div>
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
            Terkait
          </h2>
          {links}
        </div>
      </aside>
    </div>
  );
}
