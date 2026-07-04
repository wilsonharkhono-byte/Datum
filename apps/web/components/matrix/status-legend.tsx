const items: Array<{ key: string; label: string; cls: string; sym: string }> = [
  { key: "passed", label: "Selesai", cls: "bg-[var(--flag-ok-bg)] text-[var(--flag-ok)]", sym: "✓" },
  { key: "ready_for_handoff", label: "Siap serah", cls: "bg-[var(--flag-info-bg)] text-[var(--flag-info)]", sym: "►" },
  { key: "in_progress", label: "Berjalan", cls: "bg-[var(--flag-warning-bg)] text-[var(--flag-warning)]", sym: "▶" },
  { key: "blocked", label: "Terblokir", cls: "bg-[var(--flag-critical-bg)] text-[var(--flag-critical)]", sym: "■" },
  { key: "not_started", label: "Belum mulai", cls: "bg-[var(--surface-alt)] text-[var(--text-muted)]", sym: "·" },
  { key: "not_applicable", label: "N/A", cls: "bg-[var(--oat-deep)]/45 text-[var(--text-muted)]", sym: "—" },
];

export function StatusLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-2">
          <span className={`inline-block w-6 rounded-[5px] border border-[var(--border)] px-1.5 text-center font-semibold ${it.cls}`}>
            {it.sym}
          </span>
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}
