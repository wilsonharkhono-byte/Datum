"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { XIcon } from "@/components/icons/Icon";
import type { CardLinkItem, CardLinkRelation } from "@/lib/cards/link-queries";
import {
  createCardLink,
  deleteCardLink,
  searchProjectCards,
  type CardSearchHit,
} from "@/lib/cards/link-mutations";

// Direction-aware Bahasa phrasing: "out" reads from this card's point of
// view (this card → other), "in" is the inverse (other card → this one).
const RELATION_LABELS: Record<CardLinkRelation, { out: string; in: string }> = {
  depends_on: { out: "Bergantung pada", in: "Diandalkan oleh" },
  blocks:     { out: "Memblokir",       in: "Diblokir oleh" },
  related_to: { out: "Terkait dengan",  in: "Terkait dengan" },
  supersedes: { out: "Menggantikan",    in: "Digantikan oleh" },
};

const RELATION_OPTIONS: { value: CardLinkRelation; label: string }[] = [
  { value: "related_to", label: "Terkait dengan" },
  { value: "depends_on", label: "Bergantung pada" },
  { value: "blocks",     label: "Memblokir" },
  { value: "supersedes", label: "Menggantikan" },
];

export function CardLinks({
  cardId,
  projectId,
  projectCode,
  cardSlug,
  links,
}: {
  cardId: string;
  projectId: string;
  projectCode: string;
  cardSlug: string;
  links: CardLinkItem[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ── Add-link form state ──
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<CardSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CardSearchHit | null>(null);
  const [relation, setRelation] = useState<CardLinkRelation>("related_to");
  const seqRef = useRef(0);

  // Debounced search — 300ms after the last keystroke.
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2 || selected) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("term", q);
      fd.set("excludeCardId", cardId);
      void searchProjectCards(fd).then((res) => {
        if (seqRef.current !== seq) return; // stale response
        setSearching(false);
        if (res.ok) setHits(res.results);
        else setHits([]);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [term, selected, projectId, cardId]);

  function add() {
    if (!selected) return;
    setError(null);
    const fd = new FormData();
    fd.set("fromCardId", cardId);
    fd.set("toCardId", selected.id);
    fd.set("relation", relation);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await createCardLink(fd);
      if (res.ok) {
        setSelected(null);
        setTerm("");
        setHits([]);
      } else {
        setError(res.error);
      }
    });
  }

  function remove(link: CardLinkItem) {
    setError(null);
    const fd = new FormData();
    fd.set("fromCardId", link.fromCardId);
    fd.set("toCardId", link.toCardId);
    fd.set("relation", link.relation);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await deleteCardLink(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {links.length === 0 ? (
        <p className="text-[11px] italic text-[var(--text-muted)]">
          Belum ada kartu terkait. Cari kartu lain di bawah untuk menautkannya.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-1 rounded bg-[var(--sand-tint)] px-2 py-1"
            >
              <div className="min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  {RELATION_LABELS[l.relation][l.direction]}
                </span>
                <Link
                  href={`/project/${l.otherCard.projectCode}/cards/${l.otherCard.slug}`}
                  className="block truncate text-[11px] font-medium text-[var(--sand-dark)] underline-offset-2 hover:underline"
                  title={l.otherCard.title}
                >
                  {l.otherCard.title}
                </Link>
              </div>
              <button
                type="button"
                onClick={() => remove(l)}
                disabled={pending}
                aria-label={`Hapus tautan ke ${l.otherCard.title}`}
                title="Hapus tautan"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--sand-dark)] hover:text-[var(--flag-critical)] disabled:opacity-50 md:h-5 md:w-5"
              >
                <XIcon size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add-link form */}
      <div className="flex flex-col gap-1">
        {selected ? (
          <span className="inline-flex items-center justify-between gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--foreground)]">
            <span className="truncate">{selected.title}</span>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setTerm("");
              }}
              aria-label="Batalkan pilihan kartu"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded hover:text-[var(--flag-critical)] md:h-4 md:w-4"
            >
              <XIcon size={10} />
            </button>
          </span>
        ) : (
          <>
            <input
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Cari kartu…"
              aria-label="Cari kartu untuk ditautkan"
              className="min-h-11 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0"
            />
            {term.trim().length >= 2 ? (
              <ul className="flex flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)]">
                {searching ? (
                  <li className="px-2 py-1.5 text-[10px] italic text-[var(--text-muted)]">
                    Mencari…
                  </li>
                ) : hits.length === 0 ? (
                  <li className="px-2 py-1.5 text-[10px] italic text-[var(--text-muted)]">
                    Tidak ada kartu yang cocok
                  </li>
                ) : (
                  hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(h)}
                        className="block min-h-11 w-full truncate px-2 py-1.5 text-left text-[11px] hover:bg-[var(--sand-tint)] md:min-h-0"
                      >
                        {h.title}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </>
        )}

        <select
          className="select-brand-sm min-h-11 w-full md:min-h-0"
          value={relation}
          onChange={(e) => setRelation(e.target.value as CardLinkRelation)}
          aria-label="Jenis hubungan"
          disabled={pending}
        >
          {RELATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={pending || !selected}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0"
        >
          {pending ? "Menyimpan…" : "Tambah"}
        </button>
      </div>

      {error ? <p className="text-[11px] text-[var(--flag-critical)]">{error}</p> : null}
    </div>
  );
}
