import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReviewItem } from "@/components/review/ReviewItem";

export default async function ReviewPage() {
  const supabase = await createSupabaseServerClient();

  const { data: drafts, error } = await supabase
    .from("data_drafts")
    .select(`
      id, project_id, draft_type, proposed_payload, risk_level, status,
      source_type, original_input_text, created_at, created_by_staff_id,
      projects:project_id (project_code, project_name),
      created_by:created_by_staff_id (full_name)
    `)
    .eq("status", "draft")
    .eq("draft_type", "card_event")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return <div className="p-6 text-red-700">Gagal memuat: {error.message}</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Beranda</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[#141210]">Review Queue</h1>
      <p className="mt-1 text-sm text-[#524E49]">
        Draft chat-capture berisiko tinggi yang menunggu approval.
      </p>

      <ol className="mt-6 space-y-3">
        {(drafts ?? []).length === 0 ? (
          <li className="rounded border border-dashed border-[#B5AFA8] px-4 py-6 text-center text-sm italic text-[#847E78]">
            Tidak ada draft yang menunggu review.
          </li>
        ) : null}
        {(drafts ?? []).map((d) => (
          <ReviewItem key={d.id} draft={d as never} />
        ))}
      </ol>
    </div>
  );
}
