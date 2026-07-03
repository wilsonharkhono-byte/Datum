"use client";

// AreaSetup — the in-app assisted area-linking flow (R1).
//
// Opened from the Areas tab. Calls /api/areas/suggest, renders the AI proposal
// as a reviewable list: per area (editable name, include toggle) with the cards
// assigned to it nested underneath (confidence shown; low-confidence unchecked
// by default). The principal trims, then "Terapkan" calls applyAreaProposal
// with ONLY the checked items. All writes go through the session client / RLS.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyAreaProposal } from "@/lib/areas/suggest-mutations";
import type { ApplyAreaProposalResult } from "@datum/core";
import type { AreaProposal, AreaType } from "@/lib/areas/extract";
import { BACKFILL_CARD_CAP } from "@/lib/areas/backfill-selection";
import { CheckIcon, XIcon, SparkIcon } from "@/components/icons/Icon";

// Confidence below this is shown but unchecked by default.
const LOW_CONFIDENCE = 0.5;

const AREA_TYPE_LABELS: Record<AreaType, string> = {
  bathroom: "Kamar mandi",
  kitchen: "Dapur",
  bedroom: "Kamar tidur",
  living: "Ruang tamu",
  dining: "Ruang makan",
  garden: "Taman",
  circulation: "Sirkulasi",
  utility: "Utility",
  general: "Umum",
};

type CardLite = { id: string; title: string };

type Phase = "loading" | "review" | "applying" | "done" | "error";

// Editable per-area draft state in the review screen.
type AreaDraft = {
  areaCode: string;
  areaName: string;
  floor: string | null;
  areaType: AreaType;
  isExisting: boolean;
  include: boolean;
};

type AssignmentDraft = {
  cardId: string;
  areaCode: string;
  confidence: number;
  include: boolean;
};

export function AreaSetup({
  projectId,
  projectCode,
  mode = "suggest",
  onClose,
  onApplied,
}: {
  projectId: string;
  projectCode: string;
  // "suggest" (default): newest-active cards, linked or not — the original
  // assisted-setup flow. "backfill": ACTIVE cards with NO area link at all,
  // capped — the settings Areas tab "Tautkan kartu ke ruangan (AI)" action.
  mode?: "suggest" | "backfill";
  onClose: () => void;
  // Parent can refresh after a successful apply (router.refresh()).
  onApplied?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [areas, setAreas] = useState<AreaDraft[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([]);
  const [cardsById, setCardsById] = useState<Map<string, CardLite>>(new Map());
  const [result, setResult] = useState<ApplyAreaProposalResult | null>(null);
  const [backfillInfo, setBackfillInfo] = useState<{
    totalUnlinked: number;
    capped: boolean;
  } | null>(null);
  // Guard against setState after unmount (the fetch can outlive a quick close).
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/areas/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, mode }),
      });
      const data: {
        ok?: boolean;
        error?: string;
        proposal?: AreaProposal;
        cards?: CardLite[];
        totalUnlinked?: number;
        capped?: boolean;
      } = await res.json().catch(() => ({}));
      if (!aliveRef.current) return;

      if (mode === "backfill" && typeof data.totalUnlinked === "number") {
        setBackfillInfo({ totalUnlinked: data.totalUnlinked, capped: !!data.capped });
      }

      if (!res.ok || !data.ok || !data.proposal) {
        setError(
          data.error ??
            "Gagal menganalisis kartu. Periksa koneksi lalu coba lagi.",
        );
        setPhase("error");
        return;
      }

      hydrate(data.proposal, data.cards ?? []);
      setPhase("review");
    } catch {
      if (!aliveRef.current) return;
      setError("Gagal menghubungi server. Coba lagi.");
      setPhase("error");
    }
  }, [projectId, mode]);

  function hydrate(proposal: AreaProposal, cards: CardLite[]) {
    setCardsById(new Map(cards.map((c) => [c.id, c])));
    setAreas(
      proposal.areas.map((a) => ({
        areaCode: a.areaCode,
        areaName: a.areaName,
        floor: a.floor,
        areaType: a.areaType,
        isExisting: a.isExisting,
        // New areas default to included; existing areas are already in the DB,
        // they're shown only as link targets (no re-insert), so leave included.
        include: true,
      })),
    );
    setAssignments(
      proposal.assignments.map((asg) => ({
        cardId: asg.cardId,
        areaCode: asg.areaCode,
        confidence: asg.confidence,
        include: asg.confidence >= LOW_CONFIDENCE,
      })),
    );
  }

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  // ── Derived: group assignments under their area. ───────────────────────────
  const assignmentsByCode = useMemo(() => {
    const map = new Map<string, AssignmentDraft[]>();
    for (const asg of assignments) {
      const arr = map.get(asg.areaCode) ?? [];
      arr.push(asg);
      map.set(asg.areaCode, arr);
    }
    return map;
  }, [assignments]);

  const newAreaCount = areas.filter((a) => !a.isExisting && a.include).length;
  const checkedLinks = assignments.filter((a) => a.include).length;

  // ── Mutators ───────────────────────────────────────────────────────────────
  function toggleArea(code: string) {
    setAreas((prev) =>
      prev.map((a) =>
        a.areaCode === code ? { ...a, include: !a.include } : a,
      ),
    );
  }
  function renameArea(code: string, name: string) {
    setAreas((prev) =>
      prev.map((a) => (a.areaCode === code ? { ...a, areaName: name } : a)),
    );
  }
  function toggleAssignment(cardId: string, code: string) {
    setAssignments((prev) =>
      prev.map((a) =>
        a.cardId === cardId && a.areaCode === code
          ? { ...a, include: !a.include }
          : a,
      ),
    );
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  async function apply() {
    setPhase("applying");
    setError(null);

    // Only included areas + only assignments whose area is included.
    const includedCodes = new Set(
      areas.filter((a) => a.include).map((a) => a.areaCode),
    );
    // New areas to insert (existing ones are already in the DB — skip, the
    // mutation also guards, but don't send them as inserts).
    const areasPayload = areas
      .filter((a) => a.include && !a.isExisting)
      .map((a) => ({
        areaCode: a.areaCode,
        areaName: a.areaName.trim() || a.areaCode,
        floor: a.floor,
        areaType: a.areaType,
      }));
    const assignmentsPayload = assignments
      .filter((a) => a.include && includedCodes.has(a.areaCode))
      .map((a) => ({ cardId: a.cardId, areaCode: a.areaCode }));

    try {
      const res = await applyAreaProposal({
        projectId,
        projectCode,
        areas: areasPayload,
        assignments: assignmentsPayload,
      });
      if (!aliveRef.current) return;
      setResult(res);
      if (res.ok) {
        setPhase("done");
        onApplied?.();
      } else {
        setError(res.error);
        setPhase("error");
      }
    } catch (err) {
      // Server action threw (unhandled exception / network failure). Never
      // leave the modal frozen in "applying" — recover into the error phase so
      // the buttons re-enable and the user can retry or cancel. Surface the real
      // message so a failing apply is diagnosable instead of opaque.
      if (!aliveRef.current) return;
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Gagal menerapkan usulan: ${detail}. Coba lagi.`);
      setPhase("error");
    }
  }

  const nothingToApply = newAreaCount === 0 && checkedLinks === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deteksi ruangan otomatis"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "applying") onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl bg-[var(--surface)] shadow-[0_-8px_32px_-12px_rgba(122,107,86,0.5)] sm:rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--foreground)] bg-[var(--foreground)] px-4 py-3 text-[var(--text-inverse)]">
          <div className="inline-flex items-center gap-2">
            <SparkIcon size={16} />
            <span className="text-[11px] font-bold uppercase tracking-[0.12em]">
              {mode === "backfill"
                ? "Tautkan kartu ke ruangan (AI)"
                : "Deteksi ruangan otomatis"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "applying"}
            aria-label="Tutup"
            className="inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-inverse-secondary)] hover:text-[var(--text-inverse)] disabled:opacity-50"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Backfill count/cap notice */}
        {mode === "backfill" && backfillInfo && phase !== "loading" ? (
          <div className="border-b border-[var(--border)] bg-[var(--sand-tint)] px-4 py-2 text-[11px] text-[var(--sand-dark)]">
            {backfillInfo.totalUnlinked} kartu belum tertaut
            {backfillInfo.capped
              ? ` — menganalisis ${BACKFILL_CARD_CAP} kartu pertama (batch berikutnya bisa dijalankan lagi setelah ini diterapkan).`
              : "."}
          </div>
        ) : null}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {phase === "loading" ? (
            <LoadingState />
          ) : phase === "error" && areas.length === 0 ? (
            <ErrorState error={error} onRetry={load} />
          ) : phase === "done" && result?.ok ? (
            <DoneState
              result={result}
              projectCode={projectCode}
              onClose={onClose}
            />
          ) : (
            <ReviewBody
              areas={areas}
              assignmentsByCode={assignmentsByCode}
              cardsById={cardsById}
              onToggleArea={toggleArea}
              onRenameArea={renameArea}
              onToggleAssignment={toggleAssignment}
              areaTypeLabel={(t) => AREA_TYPE_LABELS[t]}
            />
          )}
        </div>

        {/* Footer (only in review/applying/error-with-data) */}
        {(phase === "review" || phase === "applying" ||
          (phase === "error" && areas.length > 0)) && (
          <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            {error && phase !== "applying" ? (
              <div className="mb-2 rounded border border-[var(--flag-critical)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)]">
                {error}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-[var(--text-secondary)]">
                {newAreaCount} area baru · {checkedLinks} kartu ditautkan
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={phase === "applying"}
                  className="inline-flex min-h-[44px] items-center rounded border border-[var(--border)] bg-[var(--surface)] px-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)] disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={phase === "applying" || nothingToApply}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded bg-[var(--foreground)] px-5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]"
                >
                  <CheckIcon size={14} />
                  {phase === "applying" ? "Menerapkan…" : "Terapkan"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <SparkIcon size={28} className="animate-pulse text-[var(--sand-dark)]" />
      <p className="text-sm font-medium text-[var(--foreground)]">
        Menganalisis kartu…
      </p>
      <p className="max-w-xs text-xs text-[var(--text-secondary)]">
        AI membaca judul dan ringkasan kartu untuk menebak ruangan. Ini biasanya
        beberapa detik.
      </p>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="text-sm font-medium text-[var(--flag-critical)]">
        {error ?? "Terjadi kesalahan."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-[44px] items-center rounded border border-[var(--border)] bg-[var(--surface)] px-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
      >
        Coba lagi
      </button>
    </div>
  );
}

function DoneState({
  result,
  projectCode,
  onClose,
}: {
  result: Extract<ApplyAreaProposalResult, { ok: true }>;
  projectCode: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--flag-ok-bg)] text-[var(--flag-ok)]">
        <CheckIcon size={24} />
      </span>
      <div>
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Berhasil diterapkan
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {result.createdAreas} area baru dibuat · {result.linkedCards} kartu
          ditautkan ke area.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={`/project/${projectCode}/schedule`}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded bg-[var(--foreground)] px-5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)]"
        >
          Hitung ulang readiness →
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-[44px] items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] px-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)]"
        >
          Selesai
        </button>
      </div>
    </div>
  );
}

function ReviewBody({
  areas,
  assignmentsByCode,
  cardsById,
  onToggleArea,
  onRenameArea,
  onToggleAssignment,
  areaTypeLabel,
}: {
  areas: AreaDraft[];
  assignmentsByCode: Map<string, AssignmentDraft[]>;
  cardsById: Map<string, CardLite>;
  onToggleArea: (code: string) => void;
  onRenameArea: (code: string, name: string) => void;
  onToggleAssignment: (cardId: string, code: string) => void;
  areaTypeLabel: (t: AreaType) => string;
}) {
  if (areas.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] p-8 text-center text-sm italic text-[var(--text-secondary)]">
        AI tidak menemukan ruangan yang jelas dari kartu yang ada. Coba tambah
        kartu dengan judul yang menyebut ruangan, atau buat area manual di tab
        Areas.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs text-[var(--text-secondary)]">
        Periksa usulan AI. Hilangkan centang pada area atau kartu yang tidak
        cocok sebelum menerapkan. Kartu dengan keyakinan rendah tidak dicentang
        otomatis.
      </p>
      {areas.map((area) => {
        const links = assignmentsByCode.get(area.areaCode) ?? [];
        return (
          <AreaReviewCard
            key={area.areaCode}
            area={area}
            links={links}
            cardsById={cardsById}
            onToggleArea={() => onToggleArea(area.areaCode)}
            onRenameArea={(name) => onRenameArea(area.areaCode, name)}
            onToggleAssignment={(cardId) =>
              onToggleAssignment(cardId, area.areaCode)
            }
            typeLabel={areaTypeLabel(area.areaType)}
          />
        );
      })}
    </div>
  );
}

function AreaReviewCard({
  area,
  links,
  cardsById,
  onToggleArea,
  onRenameArea,
  onToggleAssignment,
  typeLabel,
}: {
  area: AreaDraft;
  links: AssignmentDraft[];
  cardsById: Map<string, CardLite>;
  onToggleArea: () => void;
  onRenameArea: (name: string) => void;
  onToggleAssignment: (cardId: string) => void;
  typeLabel: string;
}) {
  return (
    <div
      className={`rounded-lg border ${
        area.include
          ? "border-[var(--sand)] bg-[var(--sand-tint)]"
          : "border-[var(--border)] bg-[var(--surface-alt)] opacity-70"
      } p-3`}
    >
      <div className="flex items-start gap-2">
        <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={area.include}
            onChange={onToggleArea}
            aria-label={`Sertakan area ${area.areaName}`}
            className="h-5 w-5 shrink-0 accent-[var(--foreground)]"
          />
          <span className="flex flex-1 flex-col gap-1">
            <input
              value={area.areaName}
              onChange={(e) => onRenameArea(e.target.value)}
              disabled={!area.include}
              aria-label="Nama area"
              className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm font-semibold text-[var(--foreground)] hover:border-[var(--border)] focus:border-[var(--sand-dark)] focus:bg-[var(--surface)] focus:outline-none disabled:text-[var(--text-muted)]"
            />
            <span className="flex flex-wrap items-center gap-2 px-1 text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">
              <span className="font-mono">{area.areaCode}</span>
              <span>· {typeLabel}</span>
              {area.floor ? <span>· {area.floor}</span> : null}
              {area.isExisting ? (
                <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 font-bold text-[var(--text-secondary)]">
                  sudah ada
                </span>
              ) : (
                <span className="rounded-full bg-[var(--flag-ok-bg)] px-2 py-0.5 font-bold text-[var(--flag-ok)]">
                  baru
                </span>
              )}
            </span>
          </span>
        </label>
      </div>

      {links.length > 0 ? (
        <div className="mt-2 grid gap-1 border-t border-[var(--sand)]/40 pt-2">
          {links.map((link) => {
            const conf = Math.round(link.confidence * 100);
            const low = link.confidence < LOW_CONFIDENCE;
            const title =
              cardsById.get(link.cardId)?.title ??
              `Kartu ${link.cardId.slice(0, 8)}`;
            return (
              <label
                key={link.cardId}
                className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded px-1 hover:bg-[var(--surface)]"
              >
                <input
                  type="checkbox"
                  checked={link.include}
                  onChange={() => onToggleAssignment(link.cardId)}
                  disabled={!area.include}
                  aria-label={`Tautkan kartu ${title} ke ${area.areaName}`}
                  className="h-4 w-4 shrink-0 accent-[var(--foreground)]"
                />
                <span className="flex-1 truncate text-xs text-[var(--foreground)]">
                  {title}
                </span>
                <span
                  className={`shrink-0 text-[10px] font-semibold uppercase ${
                    low ? "text-[var(--flag-warning)]" : "text-[var(--sand-dark)]"
                  }`}
                >
                  {conf}%
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 border-t border-[var(--sand)]/40 pt-2 text-[10px] italic text-[var(--text-muted)]">
          Belum ada kartu yang jelas untuk area ini.
        </p>
      )}
    </div>
  );
}
