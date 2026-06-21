export type { DatumClient } from "./client";

export { keys, PERSISTED_KEY_ROOTS } from "./query/keys";
export { createKVPersister, type AsyncKV } from "./query/persister";
export { makeQueryClient, CACHE_BUSTER, CACHE_MAX_AGE } from "./query/client";
export { subscribeToProjectChanges, type CardsChange } from "./realtime/project";
export { subscribeToOwnNotifications, type UnreadDelta } from "./realtime/notifications";

export {
  getCurrentStaff,
  getCurrentStaffRow,
  canManageAccess,
  type StaffRole,
  type CurrentStaff,
} from "./auth/current-staff";

export { coverImageUrl } from "./projects/cover";
export {
  getProjectsList,
  getDevelopments,
  type ProjectListItem,
  type DevelopmentOption,
} from "./projects/list";

export { COLORS, FONT_FAMILY, TYPE, SPACE, RADIUS, TOUCH_TARGET } from "./tokens";

export { makeOptimisticCard, applyAddCard, applyMoveCard, type BoardCardView, type Board, type BoardColumn } from "./cards/optimisticBoard";
export { compareEventTime, type OrderableEvent } from "./cards/event-order";
export { computeCardLabels, LABEL_STYLE, ACTOR_LABELS, type CardLabel, type CardLabelKind, type CardWithLabels, type LabelEvent } from "./cards/labels";
export { computeCardDeadlines, type DeadlineCell, type CardDeadline } from "./gates/board-deadlines";
