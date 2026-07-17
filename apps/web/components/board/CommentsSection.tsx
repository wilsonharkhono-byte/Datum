"use client";
import type { CardCommentWithAuthor } from "@datum/core";
import { CommentItem } from "./CommentItem";
import { CommentInput } from "./CommentInput";
import type { MentionCandidate } from "./MentionTextarea";

// Client component: the comment list is sourced from the cached card query
// (via CardDetailClient → useCard) instead of a per-render server fetch, so it
// repaints instantly on revisit and updates from the card-query invalidation
// that CardDetailClient drives on realtime. Realtime freshness lives in
// CardDetailClient now (it subscribes once for the whole card screen), so the
// old CommentsRefresher router.refresh() is gone.
export function CommentsSection({
  cardId,
  projectId,
  projectCode,
  cardSlug,
  cardCode,
  cardQuerySlug,
  currentStaffId,
  comments,
  mentionCandidates,
}: {
  cardId: string;
  projectId: string;
  /** projectCode/cardSlug feed the createComment server action's revalidatePath. */
  projectCode: string;
  cardSlug: string;
  /** cardCode/cardQuerySlug are the card-query identity (= useCard's code/slug)
      so the optimistic comment writes into the same cache entry the list reads. */
  cardCode: string;
  cardQuerySlug: string;
  currentStaffId: string | null;
  comments: CardCommentWithAuthor[];
  /** People who can see this card — offered by the @mention autocomplete. */
  mentionCandidates: MentionCandidate[];
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
        Diskusi ({comments.length})
      </h2>

      <ol className="space-y-2">
        {comments.length === 0 ? (
          <li className="rounded border border-dashed border-[var(--border)] p-6">
            <p className="text-xs italic text-[var(--text-secondary)]">Belum ada komentar. Mulai diskusi di bawah.</p>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">Gunakan @nama untuk menyebut rekan kerja.</p>
          </li>
        ) : null}
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            projectCode={projectCode}
            cardSlug={cardSlug}
            canEdit={currentStaffId !== null && c.created_by_staff_id === currentStaffId}
          />
        ))}
      </ol>

      <CommentInput
        cardId={cardId}
        projectId={projectId}
        projectCode={projectCode}
        cardSlug={cardSlug}
        cardCode={cardCode}
        cardQuerySlug={cardQuerySlug}
        mentionCandidates={mentionCandidates}
      />
    </section>
  );
}
