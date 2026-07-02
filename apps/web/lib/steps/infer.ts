export type CandidateStep = {
  area_step_id: string;
  step_code: string;
  name: string;
  gate_code: string;
  status: string;
};

export type StepMatch = {
  step_code: string;
  status: "in_progress" | "blocked" | "done";
  blocked_on: string | null;
  confidence: number;
};
export type StepVerdict = { is_progress: boolean; matches: StepMatch[] };
export type SelectedMatch = StepMatch & { area_step_id: string };

const VALID_STATUS = new Set(["in_progress", "blocked", "done"]);

// Event kinds carrying textual signal that can drive step inference. The team
// logs far more notes/documents/photos than dedicated 'work' events (89:1 for
// notes alone) — restricting the bridge to 'work' starved it of almost all
// real-world signal. Kept in lockstep with the migration's claim-RPC filter
// and partial index predicate (packages/db/supabase/migrations/20260702000001_kind_agnostic_inference.sql).
export const INFERABLE_KINDS: ReadonlySet<string> = new Set([
  "work",
  "note",
  "document",
  "photo",
  "client_request",
]);

/** Flatten an event payload (Json) into a short text the model can read, per event kind. */
export function summarizeEventText(kind: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

  switch (kind) {
    case "work": {
      const parts = [p.status, p.description, p.notes, p.blocked_on].filter(str);
      if (typeof p.percent_complete === "number") parts.push(`${p.percent_complete}%`);
      return parts.join(" — ");
    }
    case "note": {
      const parts = [p.body].filter(str);
      return parts.join(" — ");
    }
    case "document": {
      const parts = [p.title, p.doc_type, p.notes].filter(str);
      return parts.join(" — ");
    }
    case "photo": {
      const parts = [p.caption].filter(str);
      return parts.join(" — ");
    }
    case "client_request": {
      const parts = [p.request_text].filter(str);
      return parts.join(" — ");
    }
    default:
      return "";
  }
}

export function buildInferencePrompt(args: {
  cardTitle: string;
  eventText: string;
  candidates: CandidateStep[];
}): { systemText: string; userText: string } {
  const list = args.candidates
    .map((c) => `- ${c.step_code} (gate ${c.gate_code}): ${c.name}`)
    .join("\n");
  const systemText = `Anda asisten internal DATUM (studio interior/konstruksi).
Tugas: dari satu catatan lapangan (bisa berupa catatan kerja, note, dokumen, foto, atau permintaan klien), tentukan dulu apakah catatan ini melaporkan progres fisik pekerjaan di lapangan, lalu — jika ya — langkah pekerjaan (step) mana yang sedang dilaporkan dan statusnya.

LANGKAH 1 — is_progress:
Tentukan apakah catatan ini benar-benar melaporkan progres fisik pekerjaan di lapangan (pekerjaan sedang berjalan, selesai, atau terhambat).
Bukan progres: diskusi desain, penjadwalan, obrolan/permintaan klien, keputusan, info vendor/material tanpa pekerjaan fisik, dsb.
Jika BUKAN progres: kembalikan is_progress: false dan matches: [] — jangan lanjut ke langkah 2.

LANGKAH 2 — matches (hanya jika is_progress: true):
LANGKAH YANG TERSEDIA untuk ruangan ini (pakai HANYA step_code dari daftar ini):
${list}

ATURAN:
- Cocokkan catatan ke satu atau beberapa step_code di atas. Jika tidak ada yang cocok, kembalikan matches kosong.
- status: "in_progress" (sedang dikerjakan), "done" (selesai), atau "blocked" (terhambat).
- blocked_on: alasan singkat jika blocked, selain itu null.
- confidence: 0..1, seberapa yakin pencocokan ini.
- Jangan menebak step_code di luar daftar. Hanya laporkan yang benar-benar terlihat dari catatan.
- Laporkan HANYA pekerjaan yang sudah berjalan atau selesai. Rencana/niat ("akan", "besok", "siap mulai") BUKAN progres — jangan cocokkan step untuk itu, dan jika catatan HANYA berisi rencana/niat maka is_progress juga false.
  Contoh: "tinggal finishing cat besok" berarti pengecatan BELUM berjalan — jangan tandai step cat.`;
  const userText = `KARTU: ${args.cardTitle}\nCATATAN: ${args.eventText}`;
  return { systemText, userText };
}

export const STEP_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_progress: { type: "boolean" },
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          step_code: { type: "string" },
          status: { type: "string", enum: ["in_progress", "blocked", "done"] },
          blocked_on: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
        required: ["step_code", "status", "blocked_on", "confidence"],
      },
    },
  },
  required: ["is_progress", "matches"],
} as const;

function isStepMatch(v: unknown): v is StepMatch {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.step_code === "string" &&
    typeof m.status === "string" &&
    VALID_STATUS.has(m.status) &&
    (m.blocked_on === null || typeof m.blocked_on === "string") &&
    typeof m.confidence === "number"
  );
}

const SAFE_DEFAULT: StepVerdict = { is_progress: false, matches: [] };

export function parseStepVerdict(raw: string): StepVerdict {
  try {
    const obj = JSON.parse(raw) as unknown;
    const isProgress = (obj as { is_progress?: unknown })?.is_progress;
    if (typeof isProgress !== "boolean") return SAFE_DEFAULT;
    const matches = (obj as { matches?: unknown })?.matches;
    const parsedMatches = Array.isArray(matches) ? matches.filter(isStepMatch) : [];
    return { is_progress: isProgress, matches: parsedMatches };
  } catch {
    return SAFE_DEFAULT;
  }
}

export function selectApplicableMatches(
  verdict: StepVerdict,
  candidates: CandidateStep[],
  minConfidence: number,
): SelectedMatch[] {
  const byCode = new Map(candidates.map((c) => [c.step_code, c]));
  const out: SelectedMatch[] = [];
  for (const m of verdict.matches) {
    const c = byCode.get(m.step_code);
    if (!c) continue;
    if (m.confidence < minConfidence) continue;
    out.push({ ...m, area_step_id: c.area_step_id });
  }
  return out;
}
