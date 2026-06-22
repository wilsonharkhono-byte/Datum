export const keys = {
  board: (code: string) => ["board", code] as const,
  projects: () => ["projects"] as const,
  card: (code: string, slug: string) => ["card", code, slug] as const,
  brief: () => ["brief"] as const,
  advisor: (scope: "all" | { projectId: string }) => ["advisor", scope] as const,
  reviewDrafts: () => ["review", "drafts"] as const,
};

export const PERSISTED_KEY_ROOTS = ["board", "projects", "card", "brief", "advisor", "review"] as const;
