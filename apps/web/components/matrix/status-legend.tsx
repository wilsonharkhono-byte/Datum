const items: Array<{ key: string; label: string; cls: string; sym: string }> = [
  { key: "passed", label: "Selesai", cls: "bg-[rgba(61,139,64,0.08)] text-[#3D8B40]", sym: "✓" },
  { key: "ready_for_handoff", label: "Siap serah", cls: "bg-[rgba(21,101,192,0.08)] text-[#1565C0]", sym: "►" },
  { key: "in_progress", label: "Berjalan", cls: "bg-[rgba(230,81,0,0.10)] text-[#E65100]", sym: "▶" },
  { key: "blocked", label: "Terblokir", cls: "bg-[rgba(198,40,40,0.08)] text-[#C62828]", sym: "■" },
  { key: "not_started", label: "Belum mulai", cls: "bg-[#F2EFE9] text-[#847E78]", sym: "·" },
  { key: "not_applicable", label: "N/A", cls: "bg-[#C6C1B6]/45 text-[#847E78]", sym: "—" },
];

export function StatusLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#524E49]">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-2">
          <span className={`inline-block w-6 rounded-[5px] border border-[#B5AFA8] px-1.5 text-center font-semibold ${it.cls}`}>
            {it.sym}
          </span>
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}
