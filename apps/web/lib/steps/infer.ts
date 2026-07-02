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
export type StepVerdict = { matches: StepMatch[] };
export type SelectedMatch = StepMatch & { area_step_id: string };

const VALID_STATUS = new Set(["in_progress", "blocked", "done"]);

/** Flatten a work-event payload (Json) into a short text the model can read. */
export function summarizeWorkEvent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const parts = [p.status, p.description, p.notes, p.blocked_on]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (typeof p.percent_complete === "number") parts.push(`${p.percent_complete}%`);
  return parts.join(" — ");
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
Tugas: dari satu catatan pekerjaan di lapangan, tentukan langkah pekerjaan (step) mana yang sedang dilaporkan, dan statusnya.

LANGKAH YANG TERSEDIA untuk ruangan ini (pakai HANYA step_code dari daftar ini):
${list}

ATURAN:
- Cocokkan catatan ke satu atau beberapa step_code di atas. Jika tidak ada yang cocok, kembalikan matches kosong.
- status: "in_progress" (sedang dikerjakan), "done" (selesai), atau "blocked" (terhambat).
- blocked_on: alasan singkat jika blocked, selain itu null.
- confidence: 0..1, seberapa yakin pencocokan ini.
- Jangan menebak step_code di luar daftar. Hanya laporkan yang benar-benar terlihat dari catatan.`;
  const userText = `KARTU: ${args.cardTitle}\nCATATAN: ${args.eventText}`;
  return { systemText, userText };
}

export const STEP_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
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
  required: ["matches"],
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

export function parseStepVerdict(raw: string): StepVerdict {
  try {
    const obj = JSON.parse(raw) as unknown;
    const matches = (obj as { matches?: unknown })?.matches;
    if (!Array.isArray(matches)) return { matches: [] };
    return { matches: matches.filter(isStepMatch) };
  } catch {
    return { matches: [] };
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
