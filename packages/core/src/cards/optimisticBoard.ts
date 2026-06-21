import type { Card, Project, Topic } from "@datum/db";
import type { CardWithLabels } from "./labels";

/** Minimal board shape used for pure optimistic mutations. */
export type BoardColumn = { topic: Topic; cards: CardWithLabels[] };
export type Board = { project: Project; columns: BoardColumn[] };

/** A board card as rendered on the client: real card data plus an optional
    flag marking a still-saving optimistic (ghost) card. */
export type BoardCardView = CardWithLabels & { __optimistic?: boolean };

/** Build the ghost card shown immediately on submit, before the server insert
    completes. Pass a unique `id` (e.g. from crypto.randomUUID()) to avoid React
    key collisions when the same title is added multiple times. When `id` is
    omitted the deterministic fallback `optimistic:${topicId}:${title}` is used
    (SSR-safe, stable across renders). The card is replaced by the real row when
    the server action settles and fresh `board` data arrives. */
export function makeOptimisticCard(topicId: string, title: string, id?: string): BoardCardView {
  const base: Partial<Card> = {
    id: id ?? `optimistic:${topicId}:${title}`,
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

/** Pure: append a ghost card to the matching column. Pass a unique `id` to
    avoid React key collisions on duplicate same-title adds. Unknown topicId
    returns the board unchanged. Never mutates `board`. */
export function applyAddCard(board: Board, topicId: string, title: string, id?: string): Board {
  let matched = false;
  const columns = board.columns.map((col) => {
    if (col.topic.id !== topicId) return col;
    matched = true;
    return { ...col, cards: [...col.cards, makeOptimisticCard(topicId, title, id)] };
  });
  return matched ? { ...board, columns } : board;
}

/** Pure: move a card to `newTopicId`. Removes it from its current column and
    appends it to the target. Unknown card id returns the board unchanged.
    Never mutates `board`. */
export function applyMoveCard(board: Board, cardId: string, newTopicId: string): Board {
  let card: BoardCardView | undefined;
  for (const col of board.columns) {
    const found = col.cards.find((c) => c.id === cardId);
    if (found) { card = found; break; }
  }
  if (!card) return board;
  const moved: BoardCardView = { ...card, topic_id: newTopicId };
  const columns = board.columns.map((col) => {
    if (col.topic.id === card!.topic_id && col.topic.id !== newTopicId) {
      return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
    }
    if (col.topic.id === newTopicId) {
      return { ...col, cards: [...col.cards.filter((c) => c.id !== cardId), moved] };
    }
    return col;
  });
  return { ...board, columns };
}
