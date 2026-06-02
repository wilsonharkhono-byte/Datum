import type { CardEvent } from "@datum/db";

const KIND_LABEL: Record<string, string> = {
  decision: "Keputusan",
  drawing: "Gambar",
  survey: "Survei",
  vendor_quote: "Quote vendor",
  vendor_pick: "Vendor dipilih",
  vendor: "Vendor",
  material: "Material",
  worker_assigned: "Tukang ditugaskan",
  progress: "Progres",
  work: "Kerja",
  defect: "Defect",
  photo: "Foto",
  document: "Dokumen",
  client_request: "Permintaan klien",
  note: "Catatan",
  pending: "Menunggu",
};

function summarize(ev: CardEvent): string {
  const p = ev.payload as Record<string, unknown>;
  const candidates = ["body","description","topic","request_text","what","title","notes","caption","status","item"];
  for (const k of candidates) {
    const v = p[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return JSON.stringify(p);
}

export function PrintEventList({ events }: { events: CardEvent[] }) {
  if (events.length === 0) {
    return <p className="italic text-stone-500">Belum ada aktivitas tercatat.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-stone-300 text-left text-[9pt] uppercase tracking-wide text-stone-500">
          <th className="w-24 py-1.5 pr-2">Tanggal</th>
          <th className="w-32 py-1.5 pr-2">Jenis</th>
          <th className="py-1.5">Ringkasan</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id} className="border-b border-stone-200 align-top print-break-avoid">
            <td className="py-1.5 pr-2 text-[9pt] text-stone-600">
              {new Date(e.occurred_at).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" })}
            </td>
            <td className="py-1.5 pr-2 text-[9pt] uppercase tracking-wide text-stone-700">
              {KIND_LABEL[e.event_kind] ?? e.event_kind}
            </td>
            <td className="py-1.5 text-stone-900">{summarize(e)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
