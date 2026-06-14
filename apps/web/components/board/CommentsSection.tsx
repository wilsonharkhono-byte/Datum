"use client";
import type { CardComment } from "@datum/db";
import { CommentItem } from "./CommentItem";
import { CommentInput } from "./CommentInput";

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
  comments: CardComment[];
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A6B56]">
        Diskusi ({comments.length})
      </h2>

      <ol className="space-y-2">
        {comments.length === 0 ? (
          <li className="rounded border border-dashed border-[#B5AFA8] p-6">
            <p className="text-xs italic text-[#524E49]">Belum ada komentar. Mulai diskusi di bawah.</p>
            <p className="mt-1 text-[10px] text-[#847E78]">Gunakan @nama untuk menyebut rekan kerja.</p>
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
      />
    </section>
  );
}
