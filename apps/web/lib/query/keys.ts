export const keys = {
  board: (code: string) => ["board", code] as const,
  projects: () => ["projects"] as const,
  card: (code: string, slug: string) => ["card", code, slug] as const,
};

export const PERSISTED_KEY_ROOTS = ["board", "projects", "card"] as const;
