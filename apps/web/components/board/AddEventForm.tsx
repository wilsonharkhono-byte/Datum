"use client";
import { useState, useTransition, type ReactNode } from "react";
import { createCardEvent, attachToEvent } from "@/lib/cards/mutations";
import { uploadCardAttachment } from "@/lib/cards/upload";
import type { EventKind } from "@datum/types";

const KIND_LABELS: Record<EventKind, string> = {
  decision:        "Keputusan",
  drawing:         "Gambar",
  survey:          "Survei",
  vendor_quote:    "Quote vendor",
  vendor_pick:     "Vendor dipilih",
  material:        "Material",
  worker_assigned: "Tukang ditugaskan",
  progress:        "Progres",
  defect:          "Defect",
  photo:           "Foto",
  document:        "Dokumen",
  client_request:  "Permintaan klien",
  note:            "Catatan",
  pending:         "Menunggu / pending",
};

const KIND_ORDER: EventKind[] = [
  "note","decision","drawing","survey","vendor_quote","vendor_pick",
  "material","worker_assigned","progress","defect","photo","document",
  "client_request","pending",
];

type FieldDef =
  | { name: string; label: string; type: "text"; required?: boolean; placeholder?: string }
  | { name: string; label: string; type: "textarea"; required?: boolean; placeholder?: string; rows?: number }
  | { name: string; label: string; type: "number"; required?: boolean; min?: number; max?: number; step?: string; placeholder?: string }
  | { name: string; label: string; type: "date"; required?: boolean }
  | { name: string; label: string; type: "select"; required?: boolean; options: { value: string; label: string }[] }
  | { name: string; label: string; type: "csv"; required?: boolean; placeholder?: string };

const FIELDS_BY_KIND: Record<EventKind, FieldDef[]> = {
  note: [
    { name: "body", label: "Catatan", type: "textarea", required: true, rows: 3,
      placeholder: "Tulis catatan…" },
  ],
  decision: [
    { name: "topic", label: "Topik", type: "text", required: true,
      placeholder: "mis. marmer lantai master bath" },
    { name: "current_spec", label: "Spec saat ini", type: "text" },
    { name: "proposed_spec", label: "Spec yang diusulkan", type: "text" },
    { name: "approved_by", label: "Disetujui oleh", type: "select",
      options: [
        { value: "", label: "—" },
        { value: "client", label: "Klien" },
        { value: "principal", label: "Principal" },
        { value: "pic", label: "PIC" },
      ] },
    { name: "approval_evidence", label: "Bukti persetujuan", type: "text",
      placeholder: "mis. screenshot WA 2026-05-20" },
  ],
  drawing: [
    { name: "description", label: "Deskripsi", type: "text", required: true,
      placeholder: "mis. Survei Galleria — sample marmer" },
    { name: "drawing_code", label: "Kode gambar", type: "text",
      placeholder: "mis. A09" },
    { name: "revision", label: "Revisi", type: "text", placeholder: "mis. R3" },
    { name: "file_ref", label: "Referensi file", type: "text" },
  ],
  survey: [
    { name: "vendor_name", label: "Vendor", type: "text",
      placeholder: "mis. PT Galleria" },
    { name: "location", label: "Lokasi", type: "text" },
    { name: "attendees", label: "Peserta (pisah dengan koma)", type: "csv",
      placeholder: "mis. Wilson, Carissa" },
    { name: "notes", label: "Catatan", type: "textarea", rows: 2 },
  ],
  vendor_quote: [
    { name: "vendor_name", label: "Vendor", type: "text", required: true },
    { name: "amount", label: "Jumlah (IDR)", type: "number", required: true,
      min: 0, step: "1" },
    { name: "quote_date", label: "Tanggal quote", type: "date", required: true },
    { name: "expires_at", label: "Berlaku sampai", type: "date" },
    { name: "notes", label: "Catatan", type: "textarea", rows: 2 },
  ],
  vendor_pick: [
    { name: "vendor_name", label: "Vendor dipilih", type: "text", required: true },
    { name: "rationale", label: "Alasan", type: "textarea", rows: 2 },
  ],
  material: [
    { name: "item", label: "Item", type: "text", required: true,
      placeholder: "mis. Marmer Statuario" },
    { name: "spec", label: "Spec", type: "text" },
    { name: "status", label: "Status", type: "select", required: true,
      options: [
        { value: "specified", label: "Specified" },
        { value: "sample_approved", label: "Sample disetujui" },
        { value: "ordered", label: "Ordered" },
        { value: "delivered", label: "Delivered" },
      ] },
    { name: "quantity", label: "Jumlah", type: "number" },
    { name: "unit", label: "Satuan", type: "text", placeholder: "mis. m²" },
  ],
  worker_assigned: [
    { name: "worker_name", label: "Tukang / mandor", type: "text", required: true },
    { name: "role", label: "Peran", type: "text", placeholder: "mis. mandor cat" },
    { name: "scope", label: "Lingkup kerja", type: "textarea", rows: 2 },
    { name: "start_date", label: "Mulai", type: "date" },
  ],
  progress: [
    { name: "status", label: "Status", type: "text", required: true,
      placeholder: "mis. plesteran lt 2 selesai" },
    { name: "percent_complete", label: "% selesai", type: "number",
      min: 0, max: 100, step: "1" },
    { name: "notes", label: "Catatan", type: "textarea", rows: 2 },
  ],
  defect: [
    { name: "description", label: "Defect", type: "textarea", required: true, rows: 2 },
    { name: "severity", label: "Tingkat", type: "select", required: true,
      options: [
        { value: "low", label: "Rendah" },
        { value: "medium", label: "Sedang" },
        { value: "high", label: "Tinggi" },
      ] },
    { name: "location", label: "Lokasi", type: "text" },
    { name: "fix_required_by", label: "Perbaikan sebelum", type: "date" },
  ],
  photo: [
    { name: "caption", label: "Keterangan", type: "text",
      placeholder: "mis. dinding utara lt 2 selesai cat" },
    { name: "taken_at", label: "Diambil tanggal", type: "date" },
  ],
  document: [
    { name: "title", label: "Judul", type: "text", required: true },
    { name: "doc_type", label: "Jenis", type: "text",
      placeholder: "mis. kontrak, invoice, BoQ" },
    { name: "notes", label: "Catatan", type: "textarea", rows: 2 },
  ],
  client_request: [
    { name: "request_text", label: "Permintaan klien", type: "textarea",
      required: true, rows: 2 },
    { name: "requested_by", label: "Diminta oleh", type: "text",
      placeholder: "mis. Bu Setiono" },
    { name: "awaiting", label: "Menunggu", type: "text",
      placeholder: "mis. respon dari Wilson" },
  ],
  pending: [
    { name: "what", label: "Apa yang menunggu", type: "text", required: true },
    { name: "blocked_on", label: "Diblokir oleh", type: "text" },
  ],
};

export function AddEventForm({
  cardId,
  projectId,
  projectCode,
  cardSlug,
}: {
  cardId: string;
  projectId: string;
  projectCode: string;
  cardSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EventKind>("note");
  const [occurredAt, setOccurredAt] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0); // bump to reset form values on kind change
  const [files, setFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setUploadError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("cardId", cardId);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    fd.set("eventKind", kind);
    if (occurredAt) fd.set("occurredAt", occurredAt);
    startTransition(async () => {
      const res = await createCardEvent(fd);
      if (!res.ok) {
        setError(res.error);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      // Event created. If files were selected, upload them in series.
      if (files.length > 0) {
        setUploadState("uploading");
        for (const file of files) {
          const up = await uploadCardAttachment({
            file,
            projectId,
            cardId,
            cardEventId: res.eventId,
          });
          if (!up.ok) {
            setUploadError(`Upload gagal: ${file.name} — ${up.error}`);
            setUploadState("error");
            return; // leave the form open so user sees what failed
          }
          const aFd = new FormData();
          aFd.set("cardEventId", res.eventId);
          aFd.set("projectCode", projectCode);
          aFd.set("cardSlug", cardSlug);
          aFd.set("storagePath", up.storagePath);
          aFd.set("mimeType", up.mimeType);
          const a = await attachToEvent(aFd);
          if (!a.ok) {
            setUploadError(`Simpan lampiran gagal: ${file.name} — ${a.error}`);
            setUploadState("error");
            return;
          }
        }
        setUploadState("done");
      }
      setOpen(false);
      setOccurredAt("");
      setFiles([]);
      setUploadState("idle");
      setFormKey((k) => k + 1);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded border border-dashed border-[#B5AFA8] px-3 py-2 text-left text-xs font-medium text-[#7A6B56] hover:border-[#7A6B56] hover:bg-[#FDFAF6]"
      >
        + tambah aktivitas
      </button>
    );
  }

  const fields = FIELDS_BY_KIND[kind];

  return (
    <form
      key={formKey}
      onSubmit={submit}
      className="mt-4 rounded border border-[#B5AFA8] bg-[#FDFAF6] p-3"
    >
      <div className="mb-3 flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide text-[#7A6B56]">
          Jenis:
        </label>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as EventKind);
            setFieldErrors({});
            setFormKey((k) => k + 1);
          }}
          disabled={pending}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs"
        >
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2.5">
        {fields.map((f) => {
          const errMsg = fieldErrors[f.name];
          const baseInput =
            "w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none";
          return (
            <div key={f.name}>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[#7A6B56]">
                {f.label}{f.required ? " *" : ""}
              </label>
              {renderInput(f, baseInput, pending)}
              {errMsg ? (
                <div className="mt-0.5 text-[10px] text-red-700">{errMsg}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#7A6B56]">
          Lampiran (opsional) — foto / PDF, maks 20MB per file
        </label>
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          disabled={pending || uploadState === "uploading"}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            setFiles(list);
            setUploadError(null);
          }}
          className="block w-full text-xs text-[#524E49] file:mr-3 file:rounded file:border file:border-[#B5AFA8] file:bg-white file:px-3 file:py-1 file:text-[10px] file:font-semibold file:uppercase file:tracking-wide file:text-[#524E49] hover:file:bg-[#FDFAF6]"
        />
        {files.length > 0 ? (
          <div className="mt-1 text-[10px] text-[#847E78]">
            {files.length} file dipilih: {files.map((f) => f.name).join(", ")}
          </div>
        ) : null}
        {uploadError ? <div className="mt-1 text-[10px] text-red-700">{uploadError}</div> : null}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide text-[#7A6B56]">
          Tanggal:
        </label>
        <input
          type="date"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          disabled={pending}
          className="rounded border border-[var(--border)] px-2 py-0.5 text-xs"
        />
        <span className="text-[10px] text-[#847E78]">kosongkan untuk hari ini</span>
      </div>

      {error ? <div className="mt-2 text-[11px] text-red-700">{error}</div> : null}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[#141210] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
        >
          {pending && uploadState === "uploading" ? "Mengupload…" : pending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setOccurredAt("");
            setFieldErrors({});
            setError(null);
            setFiles([]);
            setUploadState("idle");
            setUploadError(null);
            setFormKey((k) => k + 1);
          }}
          disabled={pending}
          className="rounded px-3 py-1.5 text-[11px] font-medium text-[#524E49] hover:bg-[var(--surface-alt)]"
        >
          Batal
        </button>
      </div>
    </form>
  );
}

function renderInput(f: FieldDef, cls: string, disabled: boolean): ReactNode {
  switch (f.type) {
    case "text":
      return <input name={`payload_${f.name}`} type="text" defaultValue=""
        placeholder={f.placeholder} disabled={disabled} className={cls} />;
    case "textarea":
      return <textarea name={`payload_${f.name}`} rows={f.rows ?? 3} defaultValue=""
        placeholder={f.placeholder} disabled={disabled} className={cls} />;
    case "number":
      return <input name={`payload_${f.name}`} type="number" defaultValue=""
        min={f.min} max={f.max} step={f.step} placeholder={f.placeholder}
        disabled={disabled} className={cls} />;
    case "date":
      return <input name={`payload_${f.name}`} type="date" defaultValue=""
        disabled={disabled} className={cls} />;
    case "csv":
      return <input name={`payload_${f.name}`} type="text" defaultValue=""
        placeholder={f.placeholder} disabled={disabled} className={cls} />;
    case "select":
      return (
        <select name={`payload_${f.name}`} defaultValue={f.options[0]?.value ?? ""}
          disabled={disabled} className={cls}>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
  }
}
