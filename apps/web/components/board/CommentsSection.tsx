import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardComments } from "@/lib/cards/queries";
import { CommentItem } from "./CommentItem";
import { CommentInput } from "./CommentInput";

export async function CommentsSection({
  cardId,
  projectId,
  projectCode,
  cardSlug,
  currentStaffId,
}: {
  cardId: string;
  projectId: string;
  projectCode: string;
  cardSlug: string;
  currentStaffId: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const comments = await getCardComments(supabase, cardId);

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A6B56]">
        Diskusi ({comments.length})
      </h2>

      <ol className="space-y-2">
        {comments.length === 0 ? (
          <li className="rounded border border-dashed border-[#B5AFA8] px-3 py-3 text-xs italic text-[#847E78]">
            Belum ada komentar. Mulai diskusi di bawah.
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
      />
    </section>
  );
}
