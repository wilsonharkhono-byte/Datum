import type { Board } from "@/lib/cards/queries";
import type { CardWithLabels } from "@/lib/cards/labels";
import type { Card } from "@datum/db";

/** A board card as rendered on the client: real card data plus an optional
    flag marking a still-saving optimistic (ghost) card. */
export type BoardCardView = CardWithLabels & { __optimistic?: boolean };

export type OptimisticAction = { type: "add-card"; topicId: string; title: string };

/** Build the ghost card shown immediately on submit, before the server insert
    completes. Deterministic id (topic + title) — no Date.now/Math.random so the
    reducer stays pure and SSR-safe. The card is replaced by the real row when
    the server action settles and fresh `board` props arrive. */
function makeOptimisticCard(topicId: string, title: string): BoardCardView {
  const base: Partial<Card> = {
    id: `optimistic:${topicId}:${title}`,
    topic_id: topicId,
    title,
    slug: "",
    status: "active",
    current_summary: null,
    properties: null,
    created_by_staff_id: null,
    created_at: "",
    updated_at: "",
    last_event_at: null,
  };
  return { ...(base as Card), labels: [], deadline: null, __optimistic: true };
}

/** Pure reducer for `useOptimistic`. Returns a new Board with a ghost card
    appended to the matching column; unknown topicId returns the board unchanged.
    Never mutates `board`. */
export function optimisticReducer(board: Board, action: OptimisticAction): Board {
  if (action.type !== "add-card") return board;
  let matched = false;
  const columns = board.columns.map((col) => {
    if (col.topic.id !== action.topicId) return col;
    matched = true;
    return { ...col, cards: [...col.cards, makeOptimisticCard(action.topicId, action.title)] };
  });
  return matched ? { ...board, columns } : board;
}
