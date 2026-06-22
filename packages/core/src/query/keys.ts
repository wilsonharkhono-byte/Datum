export const keys = {
  board: (code: string) => ["board", code] as const,
  projects: () => ["projects"] as const,
  card: (code: string, slug: string) => ["card", code, slug] as const,
  brief: () => ["brief"] as const,
  advisor: (scope: "all" | { projectId: string }) => ["advisor", scope] as const,
  reviewDrafts: () => ["review", "drafts"] as const,
  notifications: (staffId: string) => ["notifications", staffId] as const,
  unreadCount: (staffId: string) => ["notifications", staffId, "unread"] as const,
  activity: () => ["activity"] as const,
  // ─── Schedule / gates / matrix ────────────────────────────────────────────
  /** Overlaid ScheduledCell[] for a project (includes per-area target overlay). */
  schedule: (projectId: string) => ["schedule", projectId] as const,
  /** Map areaId→targetDate for a project (which areas have a PM-set baseline). */
  areaTargets: (projectId: string) => ["areaTargets", projectId] as const,
  /** MatrixData (areas × gates × cells) for a project. */
  matrix: (projectId: string) => ["matrix", projectId] as const,
  /** Lampiran-A checkpoint templates for one gate (static reference, staleTime=Infinity). */
  gateCheckpoints: (gateCode: string) => ["gateCheckpoints", gateCode] as const,
  // ─── Rooms / areas ────────────────────────────────────────────────────────
  /** ProjectRooms (sorted Room[] + metadata) for a project slug. */
  rooms: (slug: string) => ["rooms", slug] as const,
  /** Area[] for a project. */
  areas: (projectId: string) => ["areas", projectId] as const,
  /** Transient AI area-extraction proposal — NOT persisted (session-only). */
  areaProposal: (projectId: string) => ["areaProposal", projectId] as const,
  // ─── Members / settings (NOT in PERSISTED_KEY_ROOTS — admin data, fetch-on-open) ─
  /** project_staff rows for a project (principal/admin only). */
  projectMembers: (projectId: string) => ["project-members", projectId] as const,
  /** All active staff (for the "add member" picker). */
  availableStaff: () => ["available-staff"] as const,
  /** Project settings row (by slug) for the settings shell + info form. */
  projectSettings: (slug: string) => ["project-settings", slug] as const,
};

export const PERSISTED_KEY_ROOTS = ["board", "projects", "card", "brief", "advisor", "review", "notifications", "activity", "schedule", "areaTargets", "matrix", "gateCheckpoints", "rooms", "areas"] as const;
