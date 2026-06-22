/**
 * MobileAddEventForm — collapsible form for adding a card event on mobile.
 *
 * Mirrors web AddEventForm field sets (Bahasa Indonesia labels). Attachment
 * upload is scoped to view + caption only (read screen already handles it);
 * a native file-picker is not wired here — a clearly-labeled TODO is left.
 *
 * NOTE: Gate recompute + principal high-risk notifications are web-only.
 * A mobile-created event won't fire those — acceptable per spec.
 */

import { useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import type { EventKind } from "@datum/types";
import { collectPayloadFromEntries } from "@datum/core";
import { Text } from "@/components/ui/Text";
import { useAddEvent } from "@/lib/query/mutations";

// ─── Labels ───────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<EventKind, string> = {
  note:           "Catatan",
  decision:       "Keputusan",
  drawing:        "Gambar",
  vendor:         "Vendor",
  material:       "Material",
  work:           "Kerja",
  client_request: "Permintaan klien",
  photo:          "Foto",
  document:       "Dokumen",
};

const KIND_ORDER: EventKind[] = [
  "note", "decision", "drawing", "vendor", "material",
  "work", "client_request", "photo", "document",
];

// ─── Field definitions (mirrors web FIELDS_BY_KIND) ───────────────────────────

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "csv";

interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

const FIELDS_BY_KIND: Record<EventKind, FieldDef[]> = {
  note: [
    { name: "body", label: "Catatan", type: "textarea", required: true,
      placeholder: "Tulis catatan…" },
  ],
  decision: [
    { name: "topic", label: "Topik", type: "text", required: true,
      placeholder: "mis. marmer lantai master bath" },
    { name: "current_spec", label: "Spec saat ini", type: "text" },
    { name: "proposed_spec", label: "Spec yang diusulkan", type: "text" },
    { name: "awaiting", label: "Menunggu siapa?", type: "select",
      options: [
        { value: "", label: "—" },
        { value: "client", label: "Klien" },
        { value: "principal", label: "Prinsipal" },
        { value: "pic", label: "PIC" },
        { value: "contractor", label: "Kontraktor" },
        { value: "architect", label: "Arsitek" },
        { value: "vendor", label: "Vendor" },
      ] },
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
    { name: "drawing_code", label: "Kode gambar", type: "text", placeholder: "mis. A09" },
    { name: "revision", label: "Revisi", type: "text", placeholder: "mis. R3" },
    { name: "file_ref", label: "Referensi file", type: "text" },
  ],
  vendor: [
    { name: "interaction", label: "Jenis interaksi", type: "select", required: true,
      options: [
        { value: "survey",   label: "Survei lokasi" },
        { value: "quote",    label: "Quote / penawaran" },
        { value: "pick",     label: "Vendor dipilih" },
        { value: "contract", label: "Kontrak" },
      ] },
    { name: "vendor_name", label: "Vendor", type: "text", required: true },
    { name: "amount", label: "Jumlah (IDR, opsional)", type: "number" },
    { name: "quote_date", label: "Tanggal quote / kunjungan", type: "date" },
    { name: "expires_at", label: "Berlaku sampai", type: "date" },
    { name: "location", label: "Lokasi (untuk survei)", type: "text" },
    { name: "attendees", label: "Peserta (pisah dengan koma)", type: "csv" },
    { name: "rationale", label: "Alasan / catatan", type: "textarea" },
  ],
  material: [
    { name: "item", label: "Item", type: "text", required: true,
      placeholder: "mis. Marmer Statuario" },
    { name: "spec", label: "Spec", type: "text" },
    { name: "status", label: "Status", type: "select", required: true,
      options: [
        { value: "specified",       label: "Specified" },
        { value: "sample_approved", label: "Sample disetujui" },
        { value: "ordered",         label: "Ordered" },
        { value: "delivered",       label: "Delivered" },
      ] },
    { name: "quantity", label: "Jumlah", type: "number" },
    { name: "unit", label: "Satuan", type: "text", placeholder: "mis. m²" },
  ],
  work: [
    { name: "status", label: "Status", type: "select", required: true,
      options: [
        { value: "assigned",    label: "Tukang ditugaskan" },
        { value: "in_progress", label: "Sedang dikerjakan" },
        { value: "blocked",     label: "Terblokir" },
        { value: "done",        label: "Selesai" },
      ] },
    { name: "blocked_on", label: "Terblokir oleh", type: "text",
      placeholder: "mis. menunggu keputusan klien soal granit" },
    { name: "worker_name", label: "Tukang / mandor", type: "text" },
    { name: "role", label: "Peran", type: "text", placeholder: "mis. mandor cat" },
    { name: "scope", label: "Lingkup kerja", type: "textarea" },
    { name: "percent_complete", label: "% selesai (opsional)", type: "number" },
    { name: "description", label: "Deskripsi (terutama untuk defect)", type: "textarea" },
    { name: "issue", label: "Jenis isu", type: "select",
      options: [
        { value: "",       label: "—" },
        { value: "defect", label: "Defect" },
      ] },
    { name: "severity", label: "Severity (untuk defect)", type: "select",
      options: [
        { value: "",       label: "—" },
        { value: "low",    label: "Rendah" },
        { value: "medium", label: "Sedang" },
        { value: "high",   label: "Tinggi" },
      ] },
    { name: "location", label: "Lokasi", type: "text" },
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
    { name: "notes", label: "Catatan", type: "textarea" },
  ],
  client_request: [
    { name: "request_text", label: "Permintaan klien", type: "textarea", required: true },
    { name: "requested_by", label: "Diminta oleh", type: "text",
      placeholder: "mis. Bu Setiono" },
    { name: "awaiting", label: "Menunggu", type: "text",
      placeholder: "mis. respon dari Wilson" },
  ],
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddEventFormProps {
  cardId: string;
  projectId: string;
  code: string;
  slug: string;
  loggedByStaffId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileAddEventForm({
  cardId,
  projectId,
  code,
  slug,
  loggedByStaffId,
}: AddEventFormProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EventKind>("note");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [occurredAt, setOccurredAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addEvent = useAddEvent(code, slug);

  function resetForm() {
    setFieldValues({});
    setOccurredAt("");
    setError(null);
  }

  function handleKindChange(newKind: EventKind) {
    setKind(newKind);
    setFieldValues({});
    setError(null);
  }

  function handleFieldChange(name: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit() {
    setError(null);
    // Build payload entries — prefix each with "payload_" so collectPayloadFromEntries works
    const entries = Object.entries(fieldValues).map(
      ([k, v]) => [`payload_${k}`, v] as const,
    );
    const payload = collectPayloadFromEntries(entries);

    addEvent.mutate(
      {
        cardId,
        projectId,
        eventKind: kind,
        payload,
        occurredAt: occurredAt || undefined,
        loggedByStaffId,
      },
      {
        onSuccess: () => {
          setOpen(false);
          resetForm();
        },
        onError: (e) => {
          setError(e instanceof Error ? e.message : "Gagal menyimpan aktivitas");
        },
      },
    );
  }

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        className="mt-2 min-h-[44px] items-center justify-center rounded border border-dashed border-border/60 px-4"
        accessibilityLabel="Catat aktivitas baru"
      >
        <Text className="text-[13px] text-text-sec">+ Catat aktivitas</Text>
      </Pressable>
    );
  }

  const fields = FIELDS_BY_KIND[kind];

  return (
    <View className="mt-2 rounded border border-border/60 bg-surface p-3">
      {/* Kind picker */}
      <Text variant="label" className="mb-1">Jenis aktivitas</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
        <View className="flex-row gap-2">
          {KIND_ORDER.map((k) => (
            <Pressable
              key={k}
              onPress={() => handleKindChange(k)}
              className={`rounded-full border px-3 py-1.5 ${
                k === kind
                  ? "border-primary bg-primary"
                  : "border-border/60 bg-surface-alt"
              }`}
              accessibilityLabel={`Pilih jenis ${KIND_LABELS[k]}`}
            >
              <Text
                className={`text-[12px] ${
                  k === kind ? "text-[#FDFAF6]" : "text-text-sec"
                }`}
              >
                {KIND_LABELS[k]}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Per-kind fields */}
      {fields.map((f) => (
        <FieldInput
          key={`${kind}-${f.name}`}
          field={f}
          value={fieldValues[f.name] ?? (f.type === "select" ? (f.options?.[0]?.value ?? "") : "")}
          onChange={(v) => handleFieldChange(f.name, v)}
          disabled={addEvent.isPending}
        />
      ))}

      {/* Date field */}
      <View className="mb-3">
        <Text variant="label" className="mb-1">Tanggal (kosongkan untuk hari ini)</Text>
        <TextInput
          value={occurredAt}
          onChangeText={setOccurredAt}
          placeholder="YYYY-MM-DD"
          editable={!addEvent.isPending}
          className="rounded border border-border/60 bg-surface-alt px-3 py-2 text-[14px] text-text"
          accessibilityLabel="Tanggal aktivitas"
        />
      </View>

      {/* Attachment note — TODO */}
      <View className="mb-3 rounded bg-surface-alt px-3 py-2">
        <Text className="text-[11px] text-text-muted italic">
          Lampiran foto / dokumen: buka kartu di browser untuk mengunggah (TODO: native file picker).
        </Text>
      </View>

      {error ? (
        <Text className="mb-2 text-[12px] text-red-700">{error}</Text>
      ) : null}

      {/* Actions */}
      <View className="flex-row gap-2">
        <Pressable
          onPress={handleSubmit}
          disabled={addEvent.isPending}
          className={`flex-1 min-h-[44px] items-center justify-center rounded ${
            addEvent.isPending ? "bg-surface-alt" : "bg-primary active:opacity-90"
          }`}
          accessibilityLabel="Simpan aktivitas"
        >
          {addEvent.isPending ? (
            <ActivityIndicator color="#FDFAF6" />
          ) : (
            <Text className="text-[13px] font-medium text-[#FDFAF6]">Simpan</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            setOpen(false);
            resetForm();
          }}
          disabled={addEvent.isPending}
          className="min-h-[44px] items-center justify-center rounded px-4 bg-surface-alt active:opacity-70"
          accessibilityLabel="Batal"
        >
          <Text className="text-[13px] text-text-sec">Batal</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── FieldInput ───────────────────────────────────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const inputClass =
    "rounded border border-border/60 bg-surface-alt px-3 py-2 text-[14px] text-text";

  return (
    <View className="mb-3">
      <Text variant="label" className="mb-1">
        {field.label}{field.required ? " *" : ""}
      </Text>

      {field.type === "select" ? (
        // React Native has no native select — use a horizontal scroll of chips
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {(field.options ?? []).map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => !disabled && onChange(opt.value)}
                className={`rounded border px-3 py-1.5 ${
                  value === opt.value
                    ? "border-primary bg-primary"
                    : "border-border/60 bg-surface-alt"
                }`}
                accessibilityLabel={`${field.label}: ${opt.label}`}
              >
                <Text
                  className={`text-[12px] ${
                    value === opt.value ? "text-[#FDFAF6]" : "text-text-sec"
                  }`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : field.type === "textarea" ? (
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={field.placeholder}
          editable={!disabled}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          className={`${inputClass} min-h-[72px]`}
          accessibilityLabel={field.label}
        />
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={field.placeholder ?? (field.type === "date" ? "YYYY-MM-DD" : undefined)}
          editable={!disabled}
          keyboardType={
            field.type === "number"
              ? "numeric"
              : "default"
          }
          className={inputClass}
          accessibilityLabel={field.label}
        />
      )}
    </View>
  );
}
