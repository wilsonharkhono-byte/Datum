const EXCLUDE_NAMES = new Set(
  ["ARCH - TEMPLATE", "INTR - TEMPLATE", "Untitled", "To Do List - Timbul"].map((s) =>
    s.trim().toUpperCase(),
  ),
);

export interface BoardRef {
  name: string;
  closed: boolean;
}

export function isInScope(board: BoardRef): { include: boolean; reason: string } {
  if (board.closed) return { include: false, reason: "closed" };
  if (EXCLUDE_NAMES.has(board.name.trim().toUpperCase())) {
    return { include: false, reason: "excluded-template-or-junk" };
  }
  return { include: true, reason: "in-scope" };
}
