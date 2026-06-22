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

// ─── Card-detail reads ────────────────────────────────────────────────────────
export {
  getCardWithTimeline,
  getCardWithTimelineByProjectCode,
  getCardAttachments,
  getCardComments,
  getCardMembers,
  getProjectStaff,
  type CardDetail,
  type CardMemberWithStaff,
} from "./cards/queries";

export { type CardPayload } from "./cards/payload";

export {
  summarize,
  extractUrls,
  looksLikeImage,
  safeHostname,
  valueLabel,
} from "./cards/event-render";

// ─── Card event mutations ─────────────────────────────────────────────────────
export {
  CreateCardEventInput,
  type CreateCardEventInputType,
  type CreateCardEventResult,
  createCardEvent,
} from "./cards/events/create";

export {
  ResolveEventInput,
  RESOLVE_STATUSES,
  type ResolveStatus,
  type ResolveEventInputType,
  type ResolveEventResult,
  resolveCardEvent,
} from "./cards/events/resolve";

export {
  collectPayloadFromEntries,
} from "./cards/events/collect-payload";

// ─── Card attachment mutations ────────────────────────────────────────────────
export {
  attachmentStoragePath,
  attachToEvent,
  type AttachToEventResult,
  signAttachment,
  type SignAttachmentResult,
  reanalyzeAttachment,
  type ReanalyzeResult,
} from "./cards/attachments";

// ─── Attachment kind helpers (pure, no server deps) ───────────────────────────
export {
  attachmentKind,
  attachmentSkipReason,
  MAX_ATTACHMENT_BYTES,
  type AttachmentKind,
} from "./attachments/kinds";

// ─── Card comment mutations ───────────────────────────────────────────────────
export {
  CreateCommentInput,
  type CreateCommentInputType,
  EditCommentInput,
  type EditCommentInputType,
  type CreateCommentResult,
  type EditCommentResult,
  type DeleteCommentResult,
  extractMentionTokens,
  resolveMentionStaffIds,
  createComment,
  editComment,
  deleteComment,
} from "./cards/comments";

// ─── Card member mutations ────────────────────────────────────────────────────
export {
  CardMemberRoleSchema,
  type CardMemberRole,
  AddCardMemberInput,
  type AddCardMemberInputType,
  RemoveCardMemberInput,
  type RemoveCardMemberInputType,
  type MemberResult,
  addCardMember,
  removeCardMember,
} from "./cards/members";

// ─── Anon-safe notification producers ────────────────────────────────────────
// notifyPrincipalsOfHighRiskEvent is NOT here — it needs the service-role admin
// client and stays in apps/web/lib/notifications/producers.ts.
export {
  notifyMentions,
  shouldNotifyWatchers,
  notifyWatchersOfEvent,
  notifyCardStatusChange,
  notifyDraftApproved,
  notifyDraftRejected,
  notifyDraftPending,
} from "./notifications/producers";
