"use client";

import { useState } from "react";
import { RULE_VERSION } from "@/lib/gates/readiness-rules";

type StatusKey =
  | "not_started"
  | "in_progress"
  | "ready_for_handoff"
  | "blocked"
  | "passed"
  | "not_applicable";

const STATUS_STYLE: Record<StatusKey, { bg: string; fg: string; border: string }> = {
  not_started:       { bg: "#e9e5dd", fg: "#524e49", border: "#cfc8bc" },
  in_progress:       { bg: "rgba(230, 81, 0, 0.18)",  fg: "#9a3c00", border: "#e65100" },
  ready_for_handoff: { bg: "rgba(21, 101, 192, 0.18)", fg: "#0d3d77", border: "#1565c0" },
  blocked:           { bg: "rgba(191, 54, 12, 0.18)",  fg: "#7a2208", border: "#bf360c" },
  passed:            { bg: "rgba(61, 139, 64, 0.18)",  fg: "#235425", border: "#3d8b40" },
  not_applicable:    { bg: "#f2efe9", fg: "#847e78", border: "#d8d3ca" },
};

const STATUS_ROWS: { key: StatusKey; label: string; rule: string }[] = [
  { key: "not_started",       label: "Belum mulai",   rule: "Belum ada aktivitas relevan di area ini." },
  { key: "in_progress",       label: "Dikerjakan",    rule: "Ada aktivitas relevan; skor naik dengan jumlah bukti (maks 0.9)." },
  { key: "ready_for_handoff", label: "Siap handoff",  rule: "Semua kartu dengan event kerja sudah selesai (status done atau progres 100%)." },
  { key: "blocked",           label: "Terblokir",     rule: "Event kerja terakhir pada salah satu kartu berstatus terblokir; alasan diambil dari blocked_on / deskripsi." },
  { key: "passed",            label: "Lulus",         rule: "Disetel manual setelah serah terima gate (slice berikutnya)." },
  { key: "not_applicable",    label: "Tidak relevan", rule: "Gate ditandai tidak berlaku untuk area tersebut." },
];

/**
 * Mirror of RELEVANT_KINDS in apps/web/lib/gates/readiness-rules.ts (rule v2).
 * Kept inline so this viewer remains a pure "documentation" component
 * without coupling to the runtime engine's internal Set type.
 * Update together with RELEVANT_KINDS whenever the rule version changes.
 */
const RELEVANT_EVENTS_PER_GATE: Record<string, string[]> = {
  A: ["work", "drawing"],
  B: ["material", "decision", "vendor", "work"],
  C: ["material", "work"],
  D: ["material", "decision", "vendor", "drawing", "work"],
  E: ["material", "work"],
  F: ["vendor", "material", "drawing", "work"],
  G: ["work"],
  H: ["client_request", "decision", "document", "work"],
};

const GATE_NAMES_ID: Record<string, string> = {
  A: "MEP Rough-in + Persiapan Struktural",
  B: "Pekerjaan Kamar Mandi",
  C: "Plafon & Penutupan Selubung",
  D: "Finishing Lantai, Dinding & Kusen Aluminium",
  E: "Finishing Permukaan + Ironwork",
  F: "Furniture Built-in & Interior",
  G: "MEP Fit-out",
  H: "Penyelesaian Akhir & Serah Terima",
};

const EVENT_KIND_LABEL_ID: Record<string, string> = {
  work:           "Kerja",
  drawing:        "Gambar",
  material:       "Material",
  decision:       "Keputusan",
  vendor:         "Vendor",
  client_request: "Permintaan klien",
  document:       "Dokumen",
};

const GATE_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

function StatusChip({ s }: { s: StatusKey }) {
  const style = STATUS_STYLE[s];
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: style.bg,
        color: style.fg,
        border: `1px solid ${style.border}`,
      }}
    >
      {STATUS_ROWS.find((r) => r.key === s)?.label ?? s}
    </span>
  );
}

export function RulesViewer() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-lg border"
      style={{
        backgroundColor: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium"
        style={{ color: "var(--foreground)" }}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs"
            style={{
              backgroundColor: "var(--surface-alt)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          >
            ?
          </span>
          Lihat aturan mesin readiness
        </span>
        <span
          aria-hidden
          className="text-xs"
          style={{ color: "var(--sand-dark)" }}
        >
          {open ? "Tutup" : "Buka"}
        </span>
      </button>

      {open && (
        <div
          className="space-y-6 border-t px-4 py-4 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        >
          {/* Section 1 — Bagaimana cara kerja */}
          <section>
            <h3 className="mb-1.5 text-sm font-semibold">Bagaimana cara kerja</h3>
            <p className="leading-relaxed" style={{ color: "var(--foreground)" }}>
              Mesin readiness mengevaluasi tiap pasangan (area × gate) dengan melihat
              event kartu yang relevan pada kartu yang terhubung ke area tersebut.
              Event itu kemudian diproses lewat pohon keputusan sederhana untuk
              menentukan warna status. Status ditampilkan di Gantt dan matrix
              area × gate.
            </p>
          </section>

          {/* Section 2 — Status & warnanya */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Status & warnanya</h3>
            <div
              className="overflow-hidden rounded border"
              style={{ borderColor: "var(--border)" }}
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead style={{ backgroundColor: "var(--surface-alt)" }}>
                  <tr>
                    <th className="px-3 py-2 font-medium" style={{ color: "var(--sand-dark)" }}>
                      Warna
                    </th>
                    <th className="px-3 py-2 font-medium" style={{ color: "var(--sand-dark)" }}>
                      Label
                    </th>
                    <th className="px-3 py-2 font-medium" style={{ color: "var(--sand-dark)" }}>
                      Kapan dipakai
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {STATUS_ROWS.map((row, i) => (
                    <tr
                      key={row.key}
                      style={{
                        borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      }}
                    >
                      <td className="px-3 py-2">
                        <StatusChip s={row.key} />
                      </td>
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2" style={{ color: "var(--sand-dark)" }}>
                        {row.rule}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3 — Pohon keputusan */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Pohon keputusan</h3>
            <ol
              className="list-decimal space-y-1.5 pl-5"
              style={{ color: "var(--foreground)" }}
            >
              <li>
                Tidak ada event relevan &rarr; <StatusChip s="not_started" />
              </li>
              <li>
                Event <code className="rounded bg-[var(--surface-alt)] px-1">work</code> terakhir
                pada salah satu kartu berstatus{" "}
                <code className="rounded bg-[var(--surface-alt)] px-1">blocked</code>{" "}
                &rarr; <StatusChip s="blocked" />{" "}
                <span style={{ color: "var(--sand-dark)" }}>
                  (alasan dari{" "}
                  <code className="rounded bg-[var(--surface-alt)] px-1">blocked_on</code>{" "}
                  atau{" "}
                  <code className="rounded bg-[var(--surface-alt)] px-1">description</code>)
                </span>
              </li>
              <li>
                Semua kartu: event <code className="rounded bg-[var(--surface-alt)] px-1">work</code> terakhir
                berstatus{" "}
                <code className="rounded bg-[var(--surface-alt)] px-1">done</code> atau{" "}
                <code className="rounded bg-[var(--surface-alt)] px-1">percent_complete ≥ 100</code>{" "}
                &rarr; <StatusChip s="ready_for_handoff" />
              </li>
              <li>
                Ada event relevan &rarr; <StatusChip s="in_progress" />{" "}
                <span style={{ color: "var(--sand-dark)" }}>
                  (skor 0.3 + n × 0.05, maks 0.9)
                </span>
              </li>
            </ol>
          </section>

          {/* Section 4 — Event yang relevan per gate */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Event yang relevan per gate</h3>
            <div
              className="overflow-hidden rounded border"
              style={{ borderColor: "var(--border)" }}
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead style={{ backgroundColor: "var(--surface-alt)" }}>
                  <tr>
                    <th className="px-3 py-2 font-medium" style={{ color: "var(--sand-dark)" }}>
                      Gate
                    </th>
                    <th className="px-3 py-2 font-medium" style={{ color: "var(--sand-dark)" }}>
                      Nama
                    </th>
                    <th className="px-3 py-2 font-medium" style={{ color: "var(--sand-dark)" }}>
                      Event relevan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {GATE_ORDER.map((code, i) => {
                    const kinds = RELEVANT_EVENTS_PER_GATE[code] ?? [];
                    const labels = kinds
                      .map((k) => EVENT_KIND_LABEL_ID[k] ?? k)
                      .join(", ");
                    return (
                      <tr
                        key={code}
                        style={{
                          borderTop: i === 0 ? "none" : "1px solid var(--border)",
                        }}
                      >
                        <td className="px-3 py-2 font-mono font-medium">{code}</td>
                        <td className="px-3 py-2">{GATE_NAMES_ID[code]}</td>
                        <td className="px-3 py-2" style={{ color: "var(--sand-dark)" }}>
                          {labels}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Footer */}
          <p
            className="border-t pt-3 text-xs italic"
            style={{ borderColor: "var(--border)", color: "var(--sand-dark)" }}
          >
            Versi aturan: v{RULE_VERSION}. Untuk mengubah aturan, edit{" "}
            <code className="rounded bg-[var(--surface-alt)] px-1 not-italic">
              apps/web/lib/gates/readiness-rules.ts
            </code>{" "}
            lalu naikkan{" "}
            <code className="rounded bg-[var(--surface-alt)] px-1 not-italic">RULE_VERSION</code>.
          </p>
        </div>
      )}
    </div>
  );
}
