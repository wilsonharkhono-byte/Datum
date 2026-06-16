import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchAll, type SearchHit } from "@/lib/search/queries";
import { SearchBox } from "@/components/search/SearchBox";

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  development: "Pengembangan",
  project: "Proyek",
  card: "Kartu",
  event: "Aktivitas",
  comment: "Komentar",
};

const KIND_COLOR: Record<SearchHit["kind"], string> = {
  development: "bg-[var(--sand)]/30 text-[var(--sand-dark)]",
  project: "bg-[var(--sand)]/20 text-[var(--sand-dark)]",
  card: "bg-[var(--flag-ok-bg)] text-[var(--flag-ok)]",
  event: "bg-[var(--sand-tint)] text-[var(--sand-dark)]",
  comment: "bg-[var(--surface-alt)] text-[var(--text-secondary)]",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const results = q.trim().length >= 2 ? await searchAll(supabase, q) : { developments: [], projects: [], cards: [], events: [], comments: [] };
  const total = results.developments.length + results.projects.length + results.cards.length + results.events.length + results.comments.length;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Beranda</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[#141210]">Cari</h1>
      <p className="mt-1 text-sm text-[#524E49]">
        Pencarian teks di seluruh proyek — proyek, kartu, aktivitas, komentar.
      </p>
      <div className="mt-4">
        <SearchBox initialQ={q} />
      </div>

      {q.trim().length === 0 ? (
        <div className="mt-8 rounded border border-dashed border-[#B5AFA8] p-6">
          <p className="text-sm italic text-[#524E49]">Ketik di kotak di atas untuk mencari kartu, aktivitas, atau komentar.</p>
          <p className="mt-1 text-xs text-[#847E78]">Pencarian berbasis teks di seluruh proyek yang Anda akses.</p>
        </div>
      ) : total === 0 ? (
        <div className="mt-8 rounded border border-dashed border-[#B5AFA8] p-6">
          <p className="text-sm italic text-[#524E49]">Tidak ada hasil untuk &ldquo;{q}&rdquo;.</p>
          <p className="mt-1 text-xs text-[#847E78]">Coba kata kunci yang lebih pendek atau cek ejaan.</p>
        </div>
      ) : (
        <p className="mt-6 text-xs text-[#7A6B56]">{total} hasil ditemukan</p>
      )}

      {[
        { label: "Pengembangan", items: results.developments },
        { label: "Proyek", items: results.projects },
        { label: "Kartu", items: results.cards },
        { label: "Aktivitas", items: results.events },
        { label: "Komentar", items: results.comments },
      ].map(({ label, items }) =>
        items.length === 0 ? null : (
          <section key={label} className="mt-6">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A6B56]">
              {label} ({items.length})
            </h2>
            <ol className="space-y-2">
              {items.map((h) => (
                <li key={h.id} className="rounded border border-[#B5AFA8] bg-white p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${KIND_COLOR[h.kind]}`}>
                      {KIND_LABEL[h.kind]}
                    </span>
                    <span className="text-[#7A6B56]">{h.projectCode}</span>
                  </div>
                  <Link href={h.href} className="font-medium text-[#141210] hover:underline">
                    {h.cardTitle || "(tanpa judul)"}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-[#524E49]">{h.snippet}</p>
                </li>
              ))}
            </ol>
          </section>
        ),
      )}
    </div>
  );
}
