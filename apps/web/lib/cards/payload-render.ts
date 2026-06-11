/**
 * Human-readable payload rendering.
 * Converts raw event payload JSON (e.g. {"request_text": "...", "requested_by": "..."})
 * into labeled key/value pairs for display in /review and timeline UIs.
 *
 * We intentionally use Bahasa-first labels and skip technical fields the
 * principal doesn't need to see (cost_currency, internal IDs, etc).
 */

const FIELD_LABELS: Record<string, string> = {
  request_text:    "Permintaan",
  requested_by:    "Diminta oleh",
  decided_text:    "Keputusan",
  decided_by:      "Diputuskan oleh",
  rationale:       "Alasan",
  vendor_name:     "Vendor",
  vendor_contact:  "Kontak vendor",
  amount:          "Nilai",
  currency:        "Mata uang",
  notes:           "Catatan",
  body:            "Isi",
  description:     "Deskripsi",
  topic:           "Topik",
  material_name:   "Material",
  material_spec:   "Spesifikasi",
  quantity:        "Kuantitas",
  unit:            "Satuan",
  worker_name:     "Tukang",
  worker_role:     "Peran tukang",
  defect_type:     "Jenis defect",
  severity:        "Tingkat",
  location:        "Lokasi",
  drawing_code:    "Kode gambar",
  drawing_version: "Versi gambar",
  caption:         "Caption",
  title:           "Judul",
  what:            "Apa",
  url:             "Tautan",
  link:            "Tautan",
  status:          "Status",
  awaiting:        "Menunggu",
  blocked_on:      "Terblokir oleh",
  issue:           "Jenis isu",
  fix_required_by: "Perbaiki sebelum",
  expires_at:      "Berlaku sampai",
  interaction:     "Interaksi",
  item:            "Material",
  spec:            "Spesifikasi",
  scope:           "Lingkup",
  percent_complete:"Progres (%)",
  proposed_spec:   "Spesifikasi diusulkan",
  current_spec:    "Spesifikasi sekarang",
  approved_by:     "Disetujui oleh",
};

const HIDDEN_FIELDS = new Set([
  // Technical / internal fields skipped from human display
  "internal_id",
  "_meta",
]);

/** Bahasa labels for well-known enum payload values (statuses, actors). */
const VALUE_LABELS: Record<string, string> = {
  needs_decision:  "Butuh keputusan",
  decided:         "Sudah diputuskan",
  superseded:      "Digantikan",
  open:            "Terbuka",
  answered:        "Terjawab",
  assigned:        "Ditugaskan",
  in_progress:     "Dikerjakan",
  blocked:         "Terblokir",
  done:            "Selesai",
  specified:       "Spesifikasi dibuat",
  sample_approved: "Sampel disetujui",
  ordered:         "Dipesan",
  delivered:       "Terkirim",
  quote:           "Penawaran",
  pick:            "Dipilih",
  contract:        "Kontrak",
  defect:          "Defect",
  client:          "Klien",
  principal:       "Prinsipal",
  pic:             "PIC",
  contractor:      "Kontraktor",
  architect:       "Arsitek",
};

export function valueLabel(v: string): string {
  return VALUE_LABELS[v] ?? v;
}

export type RenderedField = {
  key: string;
  label: string;
  value: string;
  isLongText: boolean;
};

/** Returns ordered, human-labeled fields for display. Falls back to a
 *  prettified version of the key when no label exists. */
export function renderPayload(payload: Record<string, unknown> | null | undefined): RenderedField[] {
  if (!payload || typeof payload !== "object") return [];
  const out: RenderedField[] = [];
  for (const [key, raw] of Object.entries(payload)) {
    if (HIDDEN_FIELDS.has(key)) continue;
    if (raw == null || raw === "") continue;
    const value = Array.isArray(raw)
      ? raw.map((v) => String(v)).join(", ")
      : typeof raw === "object"
      ? JSON.stringify(raw)
      : typeof raw === "string"
      ? valueLabel(raw)
      : String(raw);
    const label = FIELD_LABELS[key] ?? prettify(key);
    out.push({
      key,
      label,
      value,
      isLongText: value.length > 80,
    });
  }
  return out;
}

function prettify(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Bahasa labels for event kinds — used by chips and headers */
export const EVENT_KIND_LABELS: Record<string, string> = {
  decision:        "Keputusan",
  drawing:         "Gambar",
  survey:          "Survei",
  vendor:          "Vendor",
  vendor_quote:    "Quote vendor",
  vendor_pick:     "Vendor dipilih",
  material:        "Material",
  worker_assigned: "Tukang",
  progress:        "Progres",
  defect:          "Defect",
  photo:           "Foto",
  document:        "Dokumen",
  client_request:  "Permintaan klien",
  note:            "Catatan",
  pending:         "Menunggu",
  work:            "Pekerjaan",
};

export function eventKindLabel(kind: string): string {
  return EVENT_KIND_LABELS[kind] ?? kind;
}
