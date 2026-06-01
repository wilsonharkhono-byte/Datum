"use client";
import { useState, useTransition } from "react";
import { approveCardEventDraft, rejectCardEventDraft } from "@/lib/cards/mutations";

type Draft = {
  id: string;
  project_id: string;
  draft_type: string;
  proposed_payload: {
    kind: string;
    payload: Record<string, unknown>;
    card_id: string;
    occurred_at: string;
    rationale?: string;
  };
  risk_level: string;
  source_type: string;
  original_input_text: string | null;
  created_at: string;
  projects: { project_code: string; project_name: string } | null;
  created_by: { full_name: string | null } | null;
};

export function ReviewItem({ draft }: { draft: Draft }) {
  const [status, setStatus] = useState<"pending" | "saving" | "approved" | "rejected" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();

  function approve() {
    setError(null);
    setStatus("saving");
    const fd = new FormData();
    fd.set("draftId", draft.id);
    startTransition(async () => {
      const res = await approveCardEventDraft(fd);
      if (res.ok) setStatus("approved");
      else { setStatus("error"); setError(res.error); }
    });
  }

  function reject() {
    setError(null);
    setStatus("saving");
    const fd = new FormData();
    fd.set("draftId", draft.id);
    if (reason.trim()) fd.set("reason", reason.trim());
    startTransition(async () => {
      const res = await rejectCardEventDraft(fd);
      if (res.ok) setStatus("rejected");
      else { setStatus("error"); setError(res.error); }
    });
  }

  return (
    <li className="rounded border border-[#B5AFA8] bg-[#FDFAF6] p-4">
      <div className="mb-2 flex items-center justify-between text-[11px] text-[#7A6B56]">
        <span className="font-semibold uppercase tracking-wide">
          {draft.projects?.project_code ?? "(unknown)"} · {draft.proposed_payload.kind}
        </span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${draft.risk_level === "high" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
          {draft.risk_level} risk
        </span>
      </div>
      <div className="mb-2 text-[10px] text-[#847E78]">
        diusulkan oleh {draft.created_by?.full_name ?? "(unknown)"} ·{" "}
        {new Date(draft.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
      </div>
      {draft.original_input_text ? (
        <div className="mb-2 rounded border border-stone-200 bg-white p-2 text-xs italic text-stone-600">
          Input asli: &ldquo;{draft.original_input_text}&rdquo;
        </div>
      ) : null}
      {draft.proposed_payload.rationale ? (
        <div className="mb-2 text-[11px] italic text-[#524E49]">
          AI: &ldquo;{draft.proposed_payload.rationale}&rdquo;
        </div>
      ) : null}
      <pre className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-stone-200 bg-white p-2 text-[11px] text-stone-800">
        {JSON.stringify(draft.proposed_payload.payload, null, 2)}
      </pre>
      {error ? <div className="mb-2 text-[11px] text-red-700">{error}</div> : null}
      {status === "pending" || status === "error" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={approve}
            className="rounded bg-green-700 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-green-800">
            ✓ Setujui
          </button>
          {showReject ? (
            <div className="flex gap-1">
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="alasan (opsional)"
                className="rounded border border-stone-300 px-2 py-1 text-xs" />
              <button type="button" onClick={reject}
                className="rounded bg-red-700 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                Tolak
              </button>
              <button type="button" onClick={() => setShowReject(false)}
                className="text-[10px] text-stone-500 hover:underline">batal</button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowReject(true)}
              className="rounded border border-stone-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-700 hover:bg-stone-100">
              ✗ Tolak
            </button>
          )}
        </div>
      ) : status === "saving" ? (
        <div className="text-[11px] text-stone-600">Memproses…</div>
      ) : status === "approved" ? (
        <div className="text-[11px] font-semibold text-green-700">✓ Disetujui dan dipromosikan ke kartu.</div>
      ) : (
        <div className="text-[11px] font-semibold text-stone-500">Ditolak.</div>
      )}
    </li>
  );
}
