// Pure selection logic for the "Tautkan kartu ke ruangan (AI)" backfill
// action. Given the project's active card ids (assumed ordered
// most-recently-active first, matching the existing suggest query) and the
// set of card ids that already have at least one card_areas link, returns
// the unlinked subset to feed the extractor — capped so the model prompt
// stays bounded, with the true unlinked count surfaced separately so the UI
// can show "N kartu belum tertaut" even when N exceeds the cap.

export const BACKFILL_CARD_CAP = 100;

export type UnlinkedSelection = {
  /** Unlinked active card ids, capped at BACKFILL_CARD_CAP, input order preserved. */
  selectedIds: string[];
  /** True count of unlinked active cards, uncapped. */
  totalUnlinked: number;
  /** Whether totalUnlinked exceeds BACKFILL_CARD_CAP (i.e. selectedIds is a partial batch). */
  capped: boolean;
};

export function selectUnlinkedActiveCards(
  activeCardIds: string[],
  linkedCardIds: ReadonlySet<string>,
  cap: number = BACKFILL_CARD_CAP,
): UnlinkedSelection {
  const unlinked = activeCardIds.filter((id) => !linkedCardIds.has(id));
  return {
    selectedIds: unlinked.slice(0, cap),
    totalUnlinked: unlinked.length,
    capped: unlinked.length > cap,
  };
}
