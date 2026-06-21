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
    return (
      <div className="mx-auto w-full max-w-4xl p-4 text-[var(--flag-critical)] sm:p-6">
        Gagal memuat: {error.message}
      </div>
    );
  }

  const items = drafts ?? [];

  return (
    <div className="bg-[var(--background)] py-4 md:py-6">
      <div className="mx-auto w-full max-w-4xl px-3 md:px-4">
        <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">
          ← Beranda
        </Link>

        <header className="mt-2 mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
            Inbox principal
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
            Perlu dicek
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            Catatan dari mode <strong>Catat</strong> dengan kategori berisiko tinggi —
            permintaan klien, keputusan, vendor, pekerjaan. Klik <em>Setujui & tambah ke kartu</em> agar
            catatan ini masuk ke timeline kartu, atau <em>Tolak</em> jika AI salah tangkap.
          </p>
        </header>

        {items.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <p className="text-sm font-medium text-[var(--text-secondary)]">
              Tidak ada item yang perlu dicek.
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Inbox ini terisi saat asisten menangkap catatan berisiko tinggi dari mode Catat.
            </p>
          </div>
        ) : (
          <ol className="space-y-4">
            {items.map((d) => (
              <ReviewItem key={d.id} draft={d as never} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
