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
  // ─── Card detail sub-resources (mobile card screen) ──────────────────────
  /** Comments for one card. */
  cardComments: (cardId: string) => ["card-comments", cardId] as const,
  /** Active members of one card. */
  cardMembers: (cardId: string) => ["card-members", cardId] as const,
  /** Attachments for one card. */
  cardAttachments: (cardId: string) => ["card-attachments", cardId] as const,
  /** Topics (board columns) for a project. */
  topics: (projectId: string) => ["topics", projectId] as const,
  /** Developments list (landing grouping). */
  developments: () => ["developments"] as const,
  /** Global search results for one query string — transient, NOT persisted. */
  search: (q: string) => ["search", q] as const,
  // ─── Members / settings (NOT in PERSISTED_KEY_ROOTS — admin data, fetch-on-open) ─
  /** project_staff rows for a project (principal/admin only). */
  projectMembers: (projectId: string) => ["project-members", projectId] as const,
  /** Staff of a project as picker candidates (different row shape than
      projectMembers — do not merge the two caches). */
  projectStaff: (projectId: string) => ["project-staff", projectId] as const,
  /** All active staff (for the "add member" picker). */
  availableStaff: () => ["available-staff"] as const,
  /** Project settings row (by slug) for the settings shell + info form. */
  projectSettings: (slug: string) => ["project-settings", slug] as const,
};

export const PERSISTED_KEY_ROOTS = ["board", "projects", "card", "brief", "advisor", "review", "notifications", "activity", "schedule", "areaTargets", "matrix", "gateCheckpoints", "rooms", "areas", "card-comments", "card-members", "card-attachments", "topics", "developments"] as const;

// ─── Assistant query keys ─────────────────────────────────────────────────────

export const assistantKeys = {
  /** Snippet (card + recent events) for inline citation rendering. */
  snippet: (cardId: string, eventIds: string[]) =>
    ["assistant", "snippet", cardId, eventIds.join(",")] as const,
  /** Assistant session id (persisted per project for thread continuity). */
  session: (projectId: string) =>
    ["assistant", "session", projectId] as const,
};
