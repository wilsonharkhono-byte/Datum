/** Brand-aligned gate-status palette + labels, shared by Gantt and RulesViewer
 *  (was duplicated in both). Soft tints on warm surfaces, never the generic
 *  stone/amber/blue/green/red — those got swept earlier and no longer exist as
 *  Tailwind utilities. Values are applied via inline `style` so they can't
 *  silently disappear if the JIT misses them. Border/base colors are the
 *  --flag-* tokens; bg tints (0.18 alpha) and fg shades are derived from them
 *  and only exist here — keep this module the single source. */
export const STATUS_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  not_started:       { bg: "#e9e5dd", fg: "var(--text-secondary)", border: "#cfc8bc" },
  in_progress:       { bg: "rgba(230, 81, 0, 0.18)",  fg: "#9a3c00", border: "var(--flag-warning)" },
  ready_for_handoff: { bg: "rgba(21, 101, 192, 0.18)", fg: "#0d3d77", border: "var(--flag-info)" },
  blocked:           { bg: "rgba(191, 54, 12, 0.18)",  fg: "#7a2208", border: "var(--flag-high)" },
  passed:            { bg: "rgba(61, 139, 64, 0.18)",  fg: "#235425", border: "var(--flag-ok)" },
  not_applicable:    { bg: "var(--surface-alt)", fg: "var(--text-muted)", border: "#d8d3ca" },
};

export const STATUS_LABELS: Record<string, string> = {
  not_started:       "Belum mulai",
  in_progress:       "Dikerjakan",
  ready_for_handoff: "Siap handoff",
  blocked:           "Terblokir",
  passed:            "Lulus",
  not_applicable:    "Tidak relevan",
};
