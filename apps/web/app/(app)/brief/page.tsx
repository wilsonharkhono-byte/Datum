import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBriefData } from "@/lib/brief/queries";
import { getAdvisorItems } from "@/lib/advisor/queries";
import { BriefSection } from "@/components/brief/BriefSection";
import { AdvisorFeed } from "@/components/brief/AdvisorFeed";

export default async function BriefPage() {
  const supabase = await createSupabaseServerClient();
  const [brief, advisorItems] = await Promise.all([
    getBriefData(supabase),
    getAdvisorItems(supabase, { now: new Date(), limit: 10 }),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Beranda</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">Morning brief</p>
        <h1 className="text-3xl font-semibold text-[var(--foreground)]">Apa yang butuh perhatian hari ini</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Ringkasan lintas-proyek: keputusan yang dibutuhkan, pekerjaan terblokir, defect, permintaan klien, quote kedaluwarsa, dan gate berisiko.
        </p>
      </header>

      <div className="mb-4">
        <AdvisorFeed items={advisorItems} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BriefSection
          title="Draft menunggu approval"
          emoji="📝"
          count={brief.pendingDrafts.count}
          items={brief.pendingDrafts.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[var(--text-secondary)]">Tidak ada draft yang menunggu.</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Asisten mencatat di sini saat ada vendor quote / decision / defect berisiko tinggi.
              </p>
            </>
          }
          showAllHref="/review"
        />
        <BriefSection
          title="Keputusan dibutuhkan"
          emoji="⚖️"
          count={brief.decisionsNeeded.count}
          items={brief.decisionsNeeded.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[var(--text-secondary)]">Tidak ada keputusan yang menunggu.</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Keputusan terbuka (status: butuh keputusan) muncul di sini, dengan siapa yang ditunggu.
              </p>
            </>
          }
        />
        <BriefSection
          title="Pekerjaan terblokir"
          emoji="⏳"
          count={brief.blockers.count}
          items={brief.blockers.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[var(--text-secondary)]">Tidak ada pekerjaan terblokir.</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Catat pekerjaan dengan status &ldquo;terblokir&rdquo; + alasannya agar muncul di sini.
              </p>
            </>
          }
        />
        <BriefSection
          title="Defect aktif (30 hari)"
          emoji="🚧"
          count={brief.defects.count}
          items={brief.defects.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[var(--text-secondary)]">Tidak ada defect terbaru.</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Catat pekerjaan dengan jenis isu &ldquo;defect&rdquo; + severity agar muncul di sini.
              </p>
            </>
          }
        />
        <BriefSection
          title="Permintaan klien"
          emoji="📨"
          count={brief.awaitingClient.count}
          items={brief.awaitingClient.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[var(--text-secondary)]">Tidak ada permintaan klien aktif.</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Catat permintaan klien (kind: permintaan klien) di kartu agar tidak terlupakan.
              </p>
            </>
          }
        />
        <BriefSection
          title="Quote akan kedaluwarsa"
          emoji="💸"
          count={brief.expiringQuotes.count}
          items={brief.expiringQuotes.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[var(--text-secondary)]">Tidak ada quote yang akan kedaluwarsa.</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Quote vendor dengan tanggal berlaku, yang belum dipilih vendornya, muncul 7 hari sebelum habis.
              </p>
            </>
          }
        />
      </div>

      <section className="mt-6 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
          ⛓️ Gate berisiko (cascade)
        </h2>
        {brief.gateRisks.length === 0 ? (
          <p className="text-xs italic text-[var(--text-muted)]">Tidak ada gate yang berisiko terlambat berantai.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {brief.gateRisks.slice(0, 12).map((r) => (
              <li key={`${r.areaId}-${r.gateCode}`}>
                <Link
                  href={`/project/${r.projectCode}/schedule`}
                  className="block rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs hover:border-[var(--sand-dark)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--foreground)]">{r.projectCode} · {r.areaName}</span>
                    <span className="rounded bg-[var(--flag-warning-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--flag-warning)]">
                      Gate {r.gateCode}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{r.reason}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
          🔄 Readiness perlu di-recompute
        </h2>
        {brief.staleByProject.length === 0 ? (
          <p className="text-xs italic text-[var(--text-muted)]">Semua readiness up-to-date.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {brief.staleByProject.map((p) => (
              <li key={p.projectCode}>
                <Link
                  href={`/project/${p.projectCode}/schedule`}
                  className="block rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs hover:border-[var(--sand-dark)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--foreground)]">{p.projectCode}</span>
                    <span className="rounded bg-[var(--sand-tint)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sand-dark)]">
                      {p.staleCount} stale
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{p.projectName}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
