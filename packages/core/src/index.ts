export type { DatumClient } from "./client";

export { keys, PERSISTED_KEY_ROOTS, assistantKeys } from "./query/keys";
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

// ─── Project members (reads) ─────────────────────────────────────────────────
export {
  getProjectMembers,
  getAvailableStaff,
  type ProjectMemberRow,
} from "./projects/members";

// ─── Project by slug (settings header) ───────────────────────────────────────
export {
  getProjectBySlug,
  type ProjectSettingsRow,
} from "./projects/by-slug";

// ─── Project member mutations ─────────────────────────────────────────────────
export {
  AddProjectMemberInput,
  type AddProjectMemberInputType,
  RemoveProjectMemberInput,
  type RemoveProjectMemberInputType,
  type MemberMutationResult,
  addProjectMember,
  removeProjectMember,
} from "./projects/member-write";

// ─── Project update ───────────────────────────────────────────────────────────
export {
  PROJECT_STATUS,
  UpdateProjectInput,
  type UpdateProjectInputType,
  type UpdateProjectResult,
  updateProject,
} from "./projects/update";

// ─── Staff validation (schema only; createStaffWithPassword stays in web) ─────
export {
  STAFF_ROLES,
  type StaffRoleValue,
  CreateStaffInput,
  type CreateStaffInputType,
} from "./validation/staff";

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

// ─── Global search ────────────────────────────────────────────────────────────
export { searchAll, type SearchHit, type SearchResults } from "./search/queries";

// ─── Brief dashboard reads ────────────────────────────────────────────────────
export {
  getBriefData,
  type BriefItem,
  type BriefData,
} from "./brief/get-brief-data";

export {
  findCascadeRisks,
  findExpiringQuotes,
  type ScheduleCell,
  type GateRisk,
  type QuoteEvent,
} from "./brief/bottlenecks";

// ─── Advisor reads + ranking ──────────────────────────────────────────────────
export {
  getAdvisorData,
  getAdvisorItems,
  type GetAdvisorOpts,
  type AdvisorData,
} from "./advisor/get-advisor";

export {
  scoreItem,
  rankAdvisorItems,
  dueLabelFor,
  ageLabelFor,
} from "./advisor/rank";

export {
  type AdvisorItem,
  type AdvisorSignal,
  type AdvisorItemType,
  type GateReadyTarget,
  type AdvisorGateCell,
} from "./advisor/types";

// ─── Cards: template helpers + payload render ─────────────────────────────────
export {
  isTemplateCardTitle,
  deriveCardLabel,
} from "./cards/template-card";

export {
  renderPayload,
  eventKindLabel,
  EVENT_KIND_LABELS,
  type RenderedField,
} from "./cards/payload-render";

// ─── Gates: labels ────────────────────────────────────────────────────────────
export { gateLabel, gateShortName, GATE_SHORT_NAME } from "./gates/labels";

// ─── Gates: readiness rules (pure) ───────────────────────────────────────────
export {
  evaluateGate,
  RULE_VERSION,
  RELEVANT_KINDS,
  type ReadinessState,
  type GateInput,
  type GateResult,
} from "./gates/readiness-rules";

// ─── Gates: schedule overlay (pure) ──────────────────────────────────────────
export {
  overlayAreaTargetDates,
  shiftIsoDate,
  type ScheduledCell,
} from "./gates/schedule-overlay";

// ─── Gates: schedule reads ────────────────────────────────────────────────────
export {
  getProjectScheduleCells,
  getAreaTargetDates,
  getCardNextDeadline,
  type NextDeadline,
} from "./gates/schedule";

// ─── Gates: recompute (readiness, rule-engine) ────────────────────────────────
export {
  RecomputeInput,
  recomputeProjectGates,
  type RecomputeResult,
} from "./gates/recompute";

// ─── Gates: schedule RPC (compute_project_schedule) ──────────────────────────
export {
  recomputeProjectSchedule,
  type ScheduleRecomputeResult,
} from "./gates/schedule-rpc";

// ─── Gates: advance (markGatePassed + getGateCheckpoints) ────────────────────
export {
  MarkGatePassedInput,
  ADVANCEABLE,
  markGatePassed,
  getGateCheckpoints,
  type MarkGatePassedInput as MarkGatePassedInputType,
  type MarkGatePassedResult,
  type GateCheckpoint,
} from "./gates/advance";

// ─── Gates: area target (setAreaTargetDate) ───────────────────────────────────
export {
  TargetInput,
  setAreaTargetDate,
  type TargetInput as TargetInputType,
  type AreaTargetResult,
} from "./gates/area-target";

// ─── Matrix: fetch-matrix ─────────────────────────────────────────────────────
export {
  fetchMatrix,
  type MatrixData,
  type MatrixArea,
  type MatrixCell,
} from "./matrix/fetch-matrix";

// ─── Draft reads + mutations ──────────────────────────────────────────────────
export {
  listPendingCardEventDrafts,
  type PendingDraft,
  type ProposedCardEvent,
} from "./drafts/list-pending";

export {
  approveCardEventDraft,
  ApproveDraftInput,
  GATE_RELEVANT_KINDS,
  type ApproveDraftInputType,
  type ApproveDraftResult,
} from "./drafts/approve";

export {
  rejectCardEventDraft,
  RejectDraftInput,
  type RejectDraftInputType,
  type RejectDraftResult,
} from "./drafts/reject";

// ─── Notification queries + mutations ─────────────────────────────────────────
export {
  getRecentNotifications,
  getUnreadCount,
  type Notification,
} from "./notifications/queries";

export {
  MarkReadInput,
  type MarkReadInput as MarkReadInputType,
  type NotificationResult,
  markNotificationRead,
  markAllNotificationsRead,
} from "./notifications/mutations";

// ─── Activity feed ────────────────────────────────────────────────────────────
export {
  getRecentActivity,
  summarizeEvent,
  type ActivityItem,
  type ActivityKind,
} from "./activity/queries";

// ─── Rooms: pure derive ───────────────────────────────────────────────────────
export {
  deriveStage,
  blockerCount,
  stageProgress,
  isHandoverReady,
  nextAction,
  sortRoomsByUrgency,
  relativeTimeId,
  type CellStatus,
  type RoomGateCell,
  type RoomStage,
  type NextAction,
  type Room,
} from "./rooms/derive";

// ─── Rooms: get-rooms (client-injected) ──────────────────────────────────────
export {
  getProjectRooms,
  type ProjectRooms,
} from "./rooms/get-rooms";

// ─── Areas: queries (client-injected) ────────────────────────────────────────
export { getProjectAreas } from "./areas/queries";

// ─── Areas: mutations (client-injected; no revalidate/admin) ─────────────────
export {
  CreateAreaInput,
  type CreateAreaInputType,
  UpdateAreaInput,
  type UpdateAreaInputType,
  DeleteAreaInput,
  type DeleteAreaInputType,
  ReorderAreasInput,
  type ReorderAreasInputType,
  type AreaMutationResult,
  createArea,
  updateArea,
  deleteArea,
  reorderAreas,
} from "./areas/mutations";

// ─── Areas: AI extract helpers (pure) ────────────────────────────────────────
export {
  AREA_TYPES,
  type AreaType,
  type ExtractCard,
  type ExistingArea,
  type ProposedArea,
  type ProposedAssignment,
  type AreaProposal,
  type RawAreaProposal,
  normalizeAreaCode,
  normalizeProposal,
  parseModelJson,
} from "./areas/extract";

// ─── Areas: apply-proposal (DB mutation, anon client) ────────────────────────
export {
  ApplyAreaProposalInput,
  type ApplyAreaProposalInputType,
  type ApplyAreaProposalResult,
  applyAreaProposal,
} from "./areas/apply-proposal";

// ─── Assistant: protocol (pure NDJSON parsers + citation helpers) ─────────────
export {
  parseStreamLine,
  extractCitations,
  stripCitationTokens,
  type AssistantStreamEvent,
  type Citation,
} from "./assistant/protocol";

// ─── Assistant: schemas (Zod, shared by web routes + mobile client) ───────────
export {
  ChatRequest,
  type ChatRequest as ChatRequestType,
  CaptureRequest,
  type CaptureRequest as CaptureRequestType,
  type Proposal,
} from "./assistant/schemas";

// ─── Assistant: offline queue (storage-agnostic) ──────────────────────────────
export {
  readQueue,
  enqueue,
  peek,
  remove,
  drain,
  QUEUE_CAP,
  TANYA_MAX_AGE_MS,
  type QueuedItem,
  type QueuedMode,
  type QueueStorage,
} from "./assistant/offline-queue";

// ─── Assistant: snippet read (client-injected) ────────────────────────────────
export {
  getCardSnippet,
  type CardSnippet,
  type SnippetEvent,
} from "./assistant/snippet";

// ─── Cards: area-link (read + mutations, client-injected) ─────────────────────
export {
  AreaLinkInput,
  type AreaLinkInputType,
  type AreaLinkResult,
  getCardAreas,
  linkCardToArea,
  unlinkCardFromArea,
} from "./cards/area-link";

// ─── Push tokens (client-injected, isomorphic) ────────────────────────────────
export {
  UpsertPushTokenInput,
  type UpsertPushTokenInput as UpsertPushTokenInputType,
  type PushPlatform,
  type UpsertPushTokenResult,
  upsertPushToken,
} from "./notifications/push-tokens";
