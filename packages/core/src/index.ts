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
  canManageRole,
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
export { filterProjects, groupProjects, UNGROUPED_LABEL, type ProjectGroup } from "./projects/grouping";
export { developmentTint, TINTS, type Tint } from "./projects/tint";

export { COLORS, FONT_FAMILY, TYPE, SPACE, RADIUS, TOUCH_TARGET } from "./tokens";

export { getBoardForProject, mapBoardBundle, getProjectTopics, type Board, type BoardColumn, type BoardBundle } from "./cards/board";
export { makeOptimisticCard, applyAddCard, applyMoveCard, type BoardCardView } from "./cards/optimisticBoard";
export { compareEventTime, type OrderableEvent } from "./cards/event-order";
export { computeCardLabels, LABEL_STYLE, ACTOR_LABELS, type CardLabel, type CardLabelKind, type CardWithLabels, type LabelEvent } from "./cards/labels";
export { computeCardDeadlines, type DeadlineCell, type CardDeadline } from "./gates/board-deadlines";

export {
  CreateCardInput,
  type CreateCardInputType,
  type CreateCardResult,
  toSlug,
  createCard,
} from "./cards/create";
export {
  CreateTopicInput,
  type CreateTopicInputType,
  type CreateTopicResult,
  toTopicCode,
  createTopic,
} from "./cards/createTopic";
export {
  MoveCardInput,
  type MoveCardInputType,
  type MoveCardResult,
  moveCard,
} from "./cards/move";

export {
  CreateProjectInput,
  type CreateProjectInputType,
  type CreateProjectResult,
  createProject,
} from "./projects/create";
