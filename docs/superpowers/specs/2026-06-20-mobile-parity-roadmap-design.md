# DATUM Mobile Parity — Consolidated Roadmap

Date: 2026-06-20 · Status: roadmap (no code) · Consolidates 10 slice design specs

This roadmap stitches the ten `2026-06-20-mobile-*-design.md` slice specs into one
build plan: the full-parity goal, the locked architecture, a slice table, a
recommended build order with dependency rationale, the consolidated `@datum/core`
module map (who owns what), cross-spec conflicts to resolve, web features no spec
covers, and an aggregated risk/open-question register.

---

## 1. Goal & locked architecture

**Goal — full native parity.** Bring every authenticated web App Router surface
(`apps/web/app/(app)/**` + `/login`) to a native Expo Router app (`apps/mobile`)
at functional parity: the projects landing, project board, card detail, schedule &
readiness, rooms & areas, members/settings/project-creation, the AI assistant
(Tanya + Catat), inbox (notifications + activity), morning brief + review queue,
and global search. Indonesian-first copy, mirrored verbatim from web. PDF/print
routes (`/cards/[cardSlug]/print`, `/project/[slug]/print`) are explicitly **not**
ported as routes — native uses a Share/Print sheet, deferred.

**Locked architecture (inherited by every slice):**

1. **`@datum/core` — one isomorphic package, client-injected.** A new
   `packages/core` holds the data-access + domain logic strangled out of
   `apps/web/lib`. HARD RULE: every export takes `SupabaseClient<Database>` as its
   first arg and imports nothing from `next/*`, `server-only`, `react`,
   `react-native`, `expo*`, or `@anthropic-ai/sdk`. Pure helpers may take no
   client. The **service-role admin client is NEVER ported to mobile** (lint-banned
   in core + mobile); anything needing it stays a web/server capability.
2. **Strangler migration.** Each slice moves the smallest needed function(s) into
   `core/<area>/<verb>.ts`, drops `"use server"`/`server-only`, injects the client,
   and repoints the old `apps/web/lib/*` module to a thin re-export (queries) or a
   thin `"use server"` wrapper that parses `FormData`, calls core, then runs the
   web-only side effects (`revalidatePath`, redirect, admin-client notifications).
   Verification gate per repoint: `pnpm --filter web typecheck && test` stay green.
3. **NativeWind + shared SANO tokens.** A single token source
   (proposed `packages/core/src/tokens.ts`, the SANO `COLORS/TYPE/SPACE/RADIUS`)
   feeds both web's Tailwind v4 `@theme` and mobile's NativeWind/Tailwind config so
   the two apps never drift. No raw hex in screens; `var(--flag-*)` strings stay in
   core for web but mobile resolves the same token keys to RN values.
4. **react-query + Supabase Realtime, offline-first.** Mobile mirrors web's
   `makeQueryClient` (staleTime 30s, gcTime 24h, retry 1, `refetchOnReconnect`),
   uses a `PersistQueryClientProvider` with an **AsyncStorage** persister (the RN
   twin of web's idb-keyval), per-user namespace `datum.rq.${userId}`, and the
   shared `createKVPersister(kv, key)` seam. Realtime uses the same channel shapes
   (`subscribeToProjectChanges`, `subscribeToOwnNotifications`) refactored to take
   an injected client. `onlineManager`/`focusManager` wired to NetInfo + AppState.
   Reads go **straight to `@datum/core`** with the anon client (no `/api` hop);
   web's API routes exist only because the server needs the cookie session.
5. **Expo Router, tabs → nested stacks.** Locked tab set: **Matrix · Inbox ·
   Assistant · More**. The four flat tab files expand into nested stacks so every
   web route has a native home (foundation §4 parity map). `experiments.typedRoutes`
   is on — the tree must compile.

**Two intentional mobile-only exceptions to "reads call core directly":** the AI
**assistant** message/capture calls the existing web `/api/assistant/*` routes
(Bearer token) because `ANTHROPIC_API_KEY` must stay server-side; the **areas
suggest** flow POSTs `/api/areas/suggest` (Bearer token) to keep the cost-free
prompt assembly + key server-side. Both reads-after (snippet, apply-proposal) still
go through core directly.

---

## 1.5 Locked decisions (2026-06-20)

Ratified by the product owner at the spec-review gate; these override the
per-slice "recommendations / open questions" where they conflict.

1. **Staff creation → thin `/api/staff/create` route (Option B).** Mobile gets full
   parity: a web API route authenticates the caller's JWT, re-checks
   `canManageAccess`, then performs the service-role `createStaffWithPassword`
   server-side. (Resolves members-settings §7.2; the service-role body still never
   ships in `@datum/core`/mobile.)
2. **Schedule Gantt → per-area accordion only for v1.** The horizontal-scroll
   "Lini masa" timeline is deferred; ship the vertical per-area readiness accordion.
   (Resolves schedule-gates §7.5.)
3. **Push notifications → IN scope for v1.** `expo-notifications` is built as part of
   the `inbox` slice: a `push_tokens` table (new DB migration), device-token
   registration on login, and producer-side fan-out (server/admin client) layered
   onto the existing in-app `notifications` inserts. Foundation must reserve the
   `expo-notifications` dependency + a registration seam so inbox can land it.
   (Promotes gap §6.10 into the inbox slice.)
4. **Proceed to implementation planning, foundation slice first.** Specs are
   approved; next artifact is a `writing-plans` implementation plan for `foundation`,
   reviewed before any code.

**Still open (revisit when their slice is planned), the remaining §6 parity gaps:**
card links ("Terkait"), per-card area links (note: *required by* assistant commit —
must be owned no later than card-detail/assistant), card header editing, project
cover upload, the full interactive Area×Gate matrix grid, and native print/share.
These are not in the v1 build order yet and become follow-up slices 11+.

---

## 2. Slices

| Slice | Scope (one line) | Spec |
|---|---|---|
| `foundation` | Keystone: `@datum/core` package + strangler recipe, SANO tokens, NativeWind, react-query/persister/realtime infra, full Expo Router IA tree, session/role helpers, mobile CI. | [foundation](./2026-06-20-mobile-foundation-design.md) |
| `projects-board` | Projects landing (grouped cover-card grid + filters + developments), project board (topic carousel + tabs + filter), create/move card optimistic, create project + topic. | [projects-board](./2026-06-20-mobile-projects-board-design.md) |
| `card-detail` | Card detail screen: timeline, per-kind add-event + attachments (AI captions), comments (@mention), members; begins the `cards/mutations.ts` god-module split. | [card-detail](./2026-06-20-mobile-card-detail-design.md) |
| `inbox` | Inbox tab: notifications list + mark read (single/all), realtime unread tab badge, activity feed grouped by day, deep links into cards. | [inbox](./2026-06-20-mobile-inbox-design.md) |
| `schedule-gates` | Schedule & readiness (per-area accordion replacing the 960px Gantt), recompute, per-area handover target re-baseline, gate advance/confirm sheet, rules explainer. | [schedule-gates](./2026-06-20-mobile-schedule-gates-design.md) |
| `rooms-areas` | Rooms urgency glance (read-only), area CRUD + reorder, AI-assisted area detection (review/apply). | [rooms-areas](./2026-06-20-mobile-rooms-areas-design.md) |
| `members-settings` | Tabbed project settings shell (Akses/Areas/Proyek), member add/remove, staff creation (server endpoint), project info edit, new-project creation. | [members-settings](./2026-06-20-mobile-members-settings-design.md) |
| `assistant` | AI assistant tab: Tanya (streamed Q&A + citation snippets) + Catat (capture → ProposalCard → commit), offline send queue; calls web API routes for the LLM. | [assistant](./2026-06-20-mobile-assistant-design.md) |
| `brief-review` | Morning brief dashboard (advisor feed + 6 sections + cascade + stale) and review queue (approve/reject AI-proposed `card_event` drafts). | [brief-review](./2026-06-20-mobile-brief-review-design.md) |
| `search` | Global search: debounced multi-group search (developments/projects/cards/events/comments/attachments), grouped SectionList, tap-through navigation. | [search](./2026-06-20-mobile-search-design.md) |

> Slug note: the slices self-identify with slightly different names than their
> stated cross-references. `projects-board` is referenced elsewhere as
> `board` / `landing` / `matrix` / `projects-board`; `card-detail` as `card-detail`
> / `cards`; `inbox` as `inbox` / `inbox-review`; `schedule-gates` as
> `schedule` / `schedule-gates`; `rooms-areas` as `rooms` / `rooms-areas`;
> `members-settings` as `members` / `project-settings` / `members-settings`. The
> 10 slugs above are canonical for this roadmap.

---

## 3. Recommended build order

```
1. foundation
2. projects-board
3. card-detail
4. inbox
5. search
6. schedule-gates
7. rooms-areas
8. members-settings
9. brief-review
10. assistant
```

**Rationale (foundation first → daily core loop → derived surfaces → AI last):**

- **1. `foundation`** is a hard prerequisite for everything: it creates the
  `@datum/core` package, tsconfig path aliases, Metro/tsup build, the persister +
  query client + realtime helpers, the SANO token source, the session context, and
  the full route skeleton. Every other slice's "Depends on" list names it (or names
  the infra it ships). It also lands the demonstrator extraction
  (`getProjectsList`/`getDevelopments`) that proves the seam. Build it once, first.
- **2. `projects-board`** is the trunk of the daily loop and the highest-traffic
  surface. It owns the projects landing (the Matrix tab root) and the board, and it
  performs the first real mutation extractions (`createCard`/`moveCard`/
  `createTopic`/`createProject`) plus the shared optimistic-cache pattern every
  later mutation copies. It also owns the project route shell that card-detail,
  schedule, rooms, settings, and search all push onto.
- **3. `card-detail`** is the second-biggest read/write surface and the formal start
  of the 1090-line `cards/mutations.ts` strangler (events, comments, members,
  attachments, resolve). It needs the board route to exist (MiniCard tap target) and
  it owns `core/cards/event-render.ts` + the anon-safe notification producers that
  later slices reuse.
- **4. `inbox`** turns on the notifications/activity read path + the realtime unread
  badge that the whole app benefits from, and it owns the deep-link target contract
  (`resolveNotificationLink` → card route) that brief/review and push later reuse. It
  is small and unblocks "the app feels alive."
- **5. `search`** is the cheapest remaining slice (one already-isomorphic
  `searchAll` extraction, one screen, no mutations). Slotting it here gives a quick
  win once the navigation targets (board/card) exist, and it carries a known web bug
  forward verbatim (see §6 gaps / §7) rather than diverging.
- **6. `schedule-gates`** introduces the gate/readiness core (`fetchMatrix`,
  `readiness-rules`, `schedule-overlay`, `recompute`, `advance`, `area-target`,
  gate labels) — the cleanest pure-logic extraction in the repo — and is a hard
  prerequisite for rooms (rooms derive stage from the same matrix cells + gate
  labels). Build it before rooms so `core/matrix/fetch-matrix.ts` +
  `core/gates/labels.ts` land once.
- **7. `rooms-areas`** depends on schedule-gates' `fetchMatrix` + gate labels +
  `ReadinessState` type, and on the board route for area-scoped deep links. It also
  extracts `getProjectAreas`/area CRUD that members-settings' Areas tab renders.
- **8. `members-settings`** depends on foundation, rooms (for the Areas tab body +
  `getProjectAreas`), the landing/board entry points, and schedule (kickoff-date
  save invalidates schedule keys). It owns the disputed `createProject` extraction
  (see §6) and the staff-create server endpoint.
- **9. `brief-review`** is read-heavy but soft-depends on the project stack for deep
  links and on the assistant slice to *produce* the drafts its review queue
  consumes — so it sits late. Its core (brief/advisor/bottlenecks) is already
  isomorphic, so the slice itself is cheap; ordering is driven by its consumers
  existing, not by its own difficulty.
- **10. `assistant`** is last by dependency weight: its ProposalCard commit consumes
  the card/board core mutations (`createCard`, `createCardEvent`, `attachToEvent`,
  `uploadCardAttachment`, `linkCardToArea`) that only exist after card-detail (+ an
  area-link extraction), it needs the Matrix "current project" state, and it carries
  the one genuinely new porting cost (RN streaming transport). Building it last means
  it consumes finished core modules instead of shimming web API routes.

> Slices 2–5 can begin in parallel branches once foundation lands (board is the only
> hard predecessor among them, for card-detail's tap target and search's nav
> targets). 6→7 and 7→8 are sequential. 9 and 10 should follow their producers.

---

## 4. Consolidated `@datum/core` module map

Every core module named across the ten specs, with its **owning** slice (the slice
that extracts it) and the slices that **consume** it. "Owner" = whoever lands the
extraction first per the strangler rule; later consumers re-use, not re-extract.

### 4.1 Package + shared infra (owner: `foundation`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/index.ts` (barrel) | foundation | all |
| `core/client.ts` (`DatumClient` type alias) | foundation | all |
| `core/tokens.ts` (SANO COLORS/TYPE/SPACE/RADIUS) | foundation | all (NativeWind + web theme) |
| `core/query/client.ts` (`makeQueryClient`, `CACHE_BUSTER`, `CACHE_MAX_AGE`) | foundation | all |
| `core/query/persister.ts` (`createKVPersister`, `AsyncKV`) | foundation | all (inbox/brief/search reference it) |
| `core/query/keys.ts` (key factory + `PERSISTED_KEY_ROOTS`) | foundation | **all — shared file, see §5 conflict** |
| `core/realtime/project.ts` (`subscribeToProjectChanges`) | foundation | board, card-detail, schedule, rooms |
| `core/realtime/notifications.ts` (`subscribeToOwnNotifications`) | foundation | inbox |
| `core/auth/current-staff.ts` (`getCurrentStaff`, `getCurrentStaffRow`, `StaffRole`, `CurrentStaff`, `canManageAccess`) | foundation | board, rooms, members-settings, search |

### 4.2 Projects / board (owner: `projects-board`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/projects/list.ts` / `core/projects/queries.ts` (`getProjectsList`, `getDevelopments`, `ProjectListItem`, `DevelopmentOption`) | foundation demos `list`; projects-board owns full `queries` | members-settings (developments) |
| `core/projects/cover.ts` (`coverImageUrl`) | foundation/projects-board (see §5 conflict) | members-settings |
| `core/projects/grouping.ts` (`filterProjects`, `groupProjects`, `UNGROUPED_LABEL`) | projects-board | — |
| `core/projects/tint.ts` (`developmentTint`, `TINTS`) | projects-board | — |
| `core/projects/create.ts` (`createProject`, `CreateProjectInput`) | **disputed — see §6; resolve to members-settings** | projects-board (form) |
| `core/cards/board.ts` (`getBoardForProject`, `mapBoardBundle`, `Board`, `BoardColumn`, `BoardBundle`) | projects-board | card-detail (route only) |
| `core/cards/topics.ts` (`getProjectTopics`) | projects-board | card-detail (move sheet) |
| `core/cards/labels.ts` (`computeCardLabels`, `LABEL_STYLE`, `ACTOR_LABELS`, types) | projects-board | brief-review (ACTOR_LABELS only) |
| `core/cards/event-order.ts` (`compareEventTime`) | projects-board | card-detail, schedule, brief-review |
| `core/cards/optimisticBoard.ts` (`makeOptimisticCard`, `applyAddCard`, `applyMoveCard`, `BoardCardView`) | projects-board | — |
| `core/gates/board-deadlines.ts` (`computeCardDeadlines`, `DeadlineCell`, `CardDeadline`) | projects-board | schedule (shared — see §5) |
| `core/cards/create.ts` (`createCard`, `CreateCardInput`) | projects-board | assistant (commit) |
| `core/cards/createTopic.ts` (`createTopic`, `CreateTopicInput`) | projects-board | — |
| `core/cards/move.ts` (`moveCard`, `MoveCardInput`) | projects-board | — |
| `core/auth/access.ts` (`canManageAccess` pure predicate) | projects-board names it; foundation hosts the role helper (see §5) | rooms (`core/auth/roles.ts`), members-settings |

### 4.3 Card detail (owner: `card-detail`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/cards/queries.ts` (`getCardWithTimeline*`, `getTimelineEvents`, `getCardAttachments`, `getCardComments`, `getCardMembers`, `getProjectStaff`) | card-detail | — |
| `core/cards/payload.ts` (`CardPayload`) | card-detail | — |
| `core/cards/events/create.ts` (`createCardEvent`) | card-detail | assistant (commit) |
| `core/cards/events/resolve.ts` (`resolveCardEvent`) | card-detail | — |
| `core/cards/events/collect-payload.ts` (`collectPayload`) | card-detail | assistant |
| `core/cards/event-render.ts` (`summarize`, `extractUrls`, `looksLikeImage`, `safeHostname`) | card-detail | — |
| `core/cards/comments.ts` (`createComment`, `editComment`, `deleteComment`, `extractMentionTokens`, `resolveMentionStaffIds`) | card-detail | — |
| `core/cards/members.ts` (`addCardMember`, `removeCardMember`) | card-detail | — |
| `core/cards/attachments.ts` (`attachToEvent`, `signAttachment`, `reanalyzeAttachment`, `attachmentStoragePath`) | card-detail | assistant (commit) |
| `core/attachments/kinds.ts` (`attachmentKind`, `attachmentSkipReason`, `MAX_ATTACHMENT_BYTES`) | card-detail | — |
| `core/notifications/producers.ts` (anon-safe: `notifyMentions`, `notifyWatchersOfEvent`, `shouldNotifyWatchers`; `notifyDraft*` later) | card-detail | brief-review (notify open question) |
| `core/cards/realtime.ts` (`subscribeToProjectChanges`) | duplicated in spec; **fold into `core/realtime/project.ts` (foundation)** | board, card-detail, schedule, rooms |

### 4.4 Inbox (owner: `inbox`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/notifications/queries.ts` (`getUnreadCount`, `getRecentNotifications`) | inbox | — |
| `core/notifications/mutations.ts` (`MarkReadInput`, `markNotificationRead`, `markAllNotificationsRead`) | inbox | — |
| `core/notifications/realtime.ts` (`subscribeToOwnNotifications`) | named by inbox; **same fn foundation owns as `core/realtime/notifications.ts`** | inbox |
| `core/activity/queries.ts` (`getRecentActivity`, `summarizeEvent`, `ActivityItem`, `ActivityKind`) | inbox | — |

### 4.5 Schedule & gates (owner: `schedule-gates`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/gates/readiness-rules.ts` (`evaluateGate`, `RULE_VERSION`, `RELEVANT_KINDS`, `ReadinessState`, `GateInput`, `GateResult`) | schedule-gates | rooms (`ReadinessState` type) |
| `core/gates/event-order.ts` (`compareEventTime`) | **shared with projects-board — same source file, see §5** | schedule, rooms, brief-review |
| `core/gates/schedule-overlay.ts` (`overlayAreaTargetDates`, `shiftIsoDate`, `ScheduledCell`) | schedule-gates | — |
| `core/gates/board-deadlines.ts` (`computeCardDeadlines`) | **shared with projects-board, see §5** | board, schedule |
| `core/gates/labels.ts` (`gateShortName`, `gateLabel`, `GATE_SHORT_NAME`) | schedule-gates | rooms, brief-review |
| `core/gates/schedule.ts` (`getProjectScheduleCells`, `getAreaTargetDates`, `getCardNextDeadline`) | schedule-gates | — |
| `core/gates/recompute.ts` (`recomputeProjectGates`) | schedule-gates | card-detail (post-event recompute hand-off), brief-review |
| `core/gates/advance.ts` (`markGatePassed`, `getGateCheckpoints`, `MarkGatePassedInput`, `GateCheckpoint`) | schedule-gates | — |
| `core/gates/area-target.ts` (`setAreaTargetDate`, `TargetInput`) | schedule-gates | — |
| `core/gates/schedule-rpc.ts` (`recomputeProjectSchedule`) | schedule-gates | — |
| `core/matrix/fetch-matrix.ts` (`fetchMatrix`, `MatrixData`, `MatrixArea`, `MatrixCell`) | **schedule-gates owns; rooms consumes — coordinate, see §5** | rooms |

### 4.6 Rooms & areas (owner: `rooms-areas`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/rooms/derive.ts` (`deriveStage`, `blockerCount`, `stageProgress`, `isHandoverReady`, `nextAction`, `sortRoomsByUrgency`, `relativeTimeId`, types) | rooms-areas | — |
| `core/rooms/get-rooms.ts` (`getProjectRooms`, `ProjectRooms`; optional `get-rooms-by-code.ts`) | rooms-areas | — |
| `core/areas/mutations.ts` (`createArea`, `updateArea`, `deleteArea`, `reorderAreas` + Zod) | rooms-areas | members-settings (Areas tab) |
| `core/areas/extract.ts` (pure: `normalizeProposal`, `normalizeAreaCode`, `parseModelJson`, types) | rooms-areas | — |
| `core/areas/apply-proposal.ts` (`applyAreaProposal` + Zod) | rooms-areas | — |
| `core/auth/roles.ts` (`canManageAccess` pure predicate) | **rooms names it; foundation hosts the canonical role helper — see §5** | members-settings |
| (`getProjectAreas` read — **see §6; resolve ownership rooms vs members-settings**) | rooms-areas | members-settings |

### 4.7 Members / settings (owner: `members-settings`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/projects/members.ts` (`getProjectMembers`, `getAvailableStaff`, `ProjectMemberRow`) | members-settings | — |
| `core/projects/by-slug.ts` (`getProjectBySlug`) | members-settings | — |
| `core/projects/member-write.ts` (`addProjectMember`, `removeProjectMember`) | members-settings | — |
| `core/projects/update.ts` (`updateProject`, `UpdateProjectInput`) | members-settings | — |
| `core/projects/temp-password.ts` (`generateTempPassword`, `randomInt`) | members-settings | — |
| `core/validation/members.ts` (`AddProjectMemberInput`, `RemoveProjectMemberInput`) | members-settings | — |
| `core/validation/project.ts` (`CreateProjectInput`, `UpdateProjectInput`, `PROJECT_STATUS`) | **overlaps projects-board's `core/projects/create.ts` `CreateProjectInput` — see §5/§6** | projects-board |
| `core/validation/staff.ts` (`CreateStaffInput`, `STAFF_ROLES`) | members-settings | `/api/staff/create` route |
| (`createStaffWithPassword` service-role body — **NOT in core/mobile**; stays web `staff-mutations.ts`, exposed via `/api/staff/create`) | members-settings (web side) | — |

### 4.8 Assistant (owner: `assistant`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/assistant/protocol.ts` (`parseStreamLine`, `extractCitations`, `stripCitationTokens`, `AssistantStreamEvent`, `Citation`) | assistant | — |
| `core/assistant/schemas.ts` (`ChatRequest`, `CaptureRequest`, `Proposal`) | assistant | — |
| `core/assistant/offline-queue.ts` (`readQueue`, `enqueue`, `remove`, `drain`, `QueueStorage`, `QueuedItem`) | assistant | — |
| `core/assistant/snippet.ts` (`getCardSnippet`) | assistant | — |
| `core/assistant/keys.ts` (`assistantKeys`) | assistant | — |

### 4.9 Brief & review (owner: `brief-review`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/brief/bottlenecks.ts` (`findCascadeRisks`, `findExpiringQuotes`, types) | brief-review | — |
| `core/brief/get-brief-data.ts` (`getBriefData`, `BriefItem`, `BriefData`) | brief-review | — |
| `core/advisor/get-advisor.ts` (`getAdvisorData`, `getAdvisorItems`) | brief-review | — |
| `core/advisor/rank.ts` (`scoreItem`, `rankAdvisorItems`, `dueLabelFor`, `ageLabelFor`) | brief-review | — |
| `core/advisor/types.ts` (`AdvisorItem`, `AdvisorSignal`, …) | brief-review | — |
| `core/cards/template-card.ts` (`isTemplateCardTitle`, `deriveCardLabel`) | brief-review (also needed by assistant commit) | assistant |
| `core/cards/payload-render.ts` (`renderPayload`, `eventKindLabel`, `EVENT_KIND_LABELS`, …) | brief-review | — |
| `core/drafts/list-pending.ts` (`listPendingCardEventDrafts`, `PendingDraft`) | brief-review | — |
| `core/drafts/approve.ts` (`approveCardEventDraft`, `ApproveDraftInput`) | brief-review | — |
| `core/drafts/reject.ts` (`rejectCardEventDraft`, `RejectDraftInput`) | brief-review | — |

### 4.10 Search (owner: `search`)
| Core module | Owner | Also consumed by |
|---|---|---|
| `core/search/queries.ts` (`searchAll`, `SearchHit`, `SearchResults`, internal `highlight`) | search | — |

---

## 5. Core module conflicts (resolve before/at extraction)

These are core modules two or more specs claim, or where signatures/ownership
disagree. Each needs a one-time decision so the strangler doesn't double-extract or
diverge.

1. **`core/query/keys.ts` — claimed by ALL ten specs.** Foundation hosts the base
   factory (`board`/`projects`/`card` + `PERSISTED_KEY_ROOTS`). Every other slice
   *extends* it with its own roots (board/card already covered; inbox adds
   `inboxKeys` notifications/unreadCount/activity; schedule adds schedule/matrix/
   areaTargets/gateCheckpoints; rooms adds rooms/areas/areaProposal; members adds
   projectMembers/availableStaff/projectSettings/developments; brief adds brief/
   advisor/reviewDrafts; assistant adds `assistantKeys`; search adds `search`).
   **Risk:** concurrent edits to one file + inconsistent `PERSISTED_KEY_ROOTS`
   membership (search/areaProposal/members must NOT be persisted; rooms/areas/
   inbox/brief must be). **Resolution:** foundation owns the file and the
   `PERSISTED_KEY_ROOTS` allow-list; each slice appends its namespace in a single
   coordinated edit and explicitly states persist vs not. Card-detail and board
   both flagged the "who creates keys.ts" question — foundation answers it.

2. **`core/cards/event-order.ts` (`compareEventTime`) — claimed by `projects-board`,
   `schedule-gates`, `card-detail`, `brief-review`.** Schedule-gates lists it under
   `core/gates/event-order.ts`; the others under `core/cards/event-order.ts`. Same
   function, two proposed paths. **Resolution:** one module at `core/cards/event-order.ts`
   owned by `projects-board` (first to need it); schedule/rooms import it from there
   rather than creating `core/gates/event-order.ts`.

3. **`core/gates/board-deadlines.ts` (`computeCardDeadlines`) — claimed by
   `projects-board` AND `schedule-gates`.** Same file, same signature. **Resolution:**
   `projects-board` owns the extraction (board needs it first); schedule-gates
   imports it. No second copy under gates.

4. **`core/matrix/fetch-matrix.ts` (`fetchMatrix`) — claimed by `schedule-gates` AND
   `rooms-areas` (and the not-yet-specced `area-gate-matrix` sibling rooms names).**
   Both read `area_gate_status.status`; rooms warns of "divergent status display."
   **Resolution:** `schedule-gates` owns `fetchMatrix`; rooms imports it. Per
   schedule's open question, split the read source: schedule cells for bars/dates,
   matrix for area list + `blocking_reason`, so the two surfaces don't show
   conflicting status.

5. **`coverImageUrl` signature change — `foundation` vs `projects-board`.**
   Foundation's open question proposes either (a) move into `core/projects/cover.ts`
   reading env, or (b) keep arg-free with per-app wrappers. Projects-board commits to
   a **signature change**: `coverImageUrl(path, supabaseUrl)`. Today the web fn reads
   `process.env.NEXT_PUBLIC_SUPABASE_URL` directly (confirmed in
   `apps/web/lib/projects/cover.ts`). **Resolution:** adopt projects-board's
   explicit-arg signature; foundation's demonstrator and the web wrapper pass
   `NEXT_PUBLIC_SUPABASE_URL`, mobile passes `EXPO_PUBLIC_SUPABASE_URL`. One owner
   (whoever lands `getProjectsList` first — foundation demos it, projects-board
   finalizes), one signature.

6. **`getCurrentStaff` shape + `canManageAccess` location — `foundation` vs
   `projects-board` (`core/auth/access.ts`) vs `rooms-areas` (`core/auth/roles.ts`).**
   Web has two `getCurrentStaff` (full `Staff` in `get-current-user.ts`; trimmed
   `CurrentStaff` in `require-role.ts`). Three slices reference the role predicate
   under three module names. **Resolution:** foundation owns `core/auth/current-staff.ts`
   with the dual export (`getCurrentStaff → CurrentStaff`, `getCurrentStaffRow →
   Staff`) and the canonical pure `canManageAccess(staff|role)`. `core/auth/access.ts`
   and `core/auth/roles.ts` are the *same* predicate — pick one path
   (recommend `core/auth/current-staff.ts` exporting it) and have board/rooms/members
   import it, not re-extract.

7. **`subscribeToProjectChanges` / `subscribeToOwnNotifications` — `foundation`
   (`core/realtime/*`) vs `card-detail`/`schedule`/`rooms` (`core/cards/realtime.ts`)
   vs `inbox` (`core/notifications/realtime.ts`).** Same functions, two path
   families. **Resolution:** foundation owns both under `core/realtime/{project,notifications}.ts`
   (client-injected). Card-detail/schedule/rooms/inbox import from there; the schedule
   + rooms "gate-status realtime" channel is a *new* subscription modeled on the same
   helper (and depends on `area_gate_status` being in the realtime publication — see
   §7).

8. **`CreateProjectInput` / `createProject` — `projects-board` (`core/projects/create.ts`,
   `createProject(supabase, input, caller)`) vs `members-settings`
   (`core/validation/project.ts` + `core/projects/create.ts`,
   `createProject(supabase, caller, input, userId)`).** Two specs extract the same
   mutation with **different argument orders/shapes** and both claim the create-project
   screen. **Resolution (also a gap, see §6):** `members-settings` owns the
   create-project screen + `createProject` extraction + `CreateProjectInput`;
   `projects-board` defers to it and imports the schema for its form. Lock one
   signature — recommend `createProject(supabase, caller, input, userId)` per
   members-settings — so the web wrapper stays free of `next/headers`.

---

## 6. Gaps — web features no spec covers

Cross-referencing `apps/web/app/**` routes and `apps/web/lib/**` modules against all
ten specs surfaces the following uncovered (or only-deferred) features. None block
the build order; each is a parity gap to schedule as a follow-up slice.

1. **Card links ("Terkait") — `apps/web/lib/cards/link-queries.ts` +
   `link-mutations.ts` + `components/board/CardLinks.tsx`.** The card-detail sidebar's
   related-card panel. Explicitly out of scope in card-detail; **no slice owns it.**
2. **Card areas on the card — `apps/web/lib/cards/area-link-queries.ts`
   (`getCardAreas`) + `area-link-mutations.ts` (`linkCardToArea`, unlink) +
   `components/board/CardAreas.tsx`.** Out of scope in card-detail; rooms-areas covers
   project-level area CRUD but NOT the per-card area link panel. **assistant depends on
   `linkCardToArea`** for ProposalCard commit — so this extraction is implicitly
   required by assistant but unowned. Gap.
3. **Card header editing — `updateCard` (in `cards/mutations.ts`) +
   `components/board/CardHeader.tsx` (title/summary/status edit) + the
   `notifyCardStatusChange` producer.** Card-detail is display-only for the header.
   **No slice owns card field editing.**
4. **Full Area×Gate matrix grid — `apps/web/components/matrix/{area-gate-matrix,cell,
   status-legend}.tsx`.** Rendered on the web schedule page. Schedule-gates surfaces
   status inside the per-area accordion and explicitly defers "the full
   `AreaGateMatrix` interactive grid" to a sibling `area-gate-matrix` slice that **is
   not written.** Gap (the interactive grid view).
5. **Project cover upload — `apps/web/lib/projects/cover-upload.ts`
   (`uploadProjectCover`) + `ProjectEditDialog` + the landing card edit affordance.**
   Deferred by both members-settings (§out of scope) and projects-board (settings
   slice). **No slice owns cover upload or the landing project-edit dialog.**
6. **PDF/print — `/project/[slug]/cards/[cardSlug]/print`, `/project/[slug]/print`,
   `components/print/{PrintCard,PrintEventList,PrintLayout}.tsx`.** Intentionally not
   ported as routes (foundation: native Share/Print sheet, deferred). Gap = no native
   print/share affordance is specced anywhere.
7. **`/api/cards/[cardId]/next-deadline` route + `getCardNextDeadline` consumer UI.**
   `getCardNextDeadline` is extracted by schedule-gates, but the web component that
   calls the route (deadline chip refresh) has no named mobile consumer. Minor gap.
8. **`createProject` screen ownership (also a §5 conflict).** Listed here because
   until the conflict is resolved it is *ambiguously* owned — resolve to
   members-settings.
9. **`getProjectAreas` extraction ownership** is unresolved between rooms-areas and
   members-settings (both may extract it). Coordinate so it's extracted once.
10. ~~**Push notifications (`expo-notifications`)** — no slice builds it.~~
    **RESOLVED 2026-06-20 (see §1.5): now IN scope for v1, built in the `inbox` slice**
    (`push_tokens` DB migration + device-token registration + producer-side fan-out;
    foundation reserves the dependency + registration seam).
11. **Cost-layer display gating UI.** `cost_visible` is respected via RLS everywhere
    (results just come back empty), but the explicit web cost-visibility *header
    indicator* / vendor-amount rendering rules are noted as "a later slice" by
    foundation and never specced. Gap.
12. **Known shared-code bug carried forward (not a missing feature, but a flagged
    defect):** `apps/web/lib/search/queries.ts` projects group `.or()` filters on
    `site_address` while it selects/snippets `location` — searching by location text
    matches nothing. The search slice deliberately preserves web behavior verbatim and
    flags it for a separate cross-app fix in `@datum/core` so web + mobile move
    together. Track it as a post-extraction core fix, not a mobile divergence.

---

## 7. Risks & open questions (aggregated)

### 7.1 Cross-cutting infra (decide once, in `foundation`)
- **Metro + workspace packages on Expo SDK 56:** is a `metro.config.js` with
  `watchFolders`/monorepo resolution required for `@datum/core`'s built `dist/`, or
  can Metro transpile `src` directly? Verify against docs.expo.dev/versions/v56.0.0
  per `apps/mobile/AGENTS.md`. Decide tsup-built `dist` vs raw `src`.
- **react-query as a peerDependency:** mobile declares none today; pin
  `@tanstack/react-query` + `@tanstack/react-query-persist-client` to web's
  `^5.101.0` so persist-client APIs align.
- **NativeWind version** compatible with RN 0.85 / React 19 / Expo 56, and the shared
  token-source format consumable by both Tailwind v4 `@theme` and NativeWind config.
- **Host `makeQueryClient`/persister in `@datum/core/query` (shared) vs per-app** —
  multiple specs assume shared; confirm in foundation.
- **Hermes Intl** support for `timeZone:'Asia/Jakarta'` (WIB overdue/"hari ini" math)
  and `id-ID` locale (`toLocaleDateString` day-grouping in inbox/activity). Verify on
  target devices; ship a fixed-offset/fixed-formatter fallback if ICU is incomplete.
- **`crypto.randomUUID` / `crypto.getRandomValues` in Hermes** — needed for optimistic
  ids (board), offline-queue ids (assistant), and `generateTempPassword`
  (members-settings). Confirm existing polyfills cover it or add `expo-crypto`.
- **`EXPO_PUBLIC_*` env wiring:** `EXPO_PUBLIC_SUPABASE_URL` (cover URLs),
  `EXPO_PUBLIC_WEB_BASE_URL` (assistant routes), `EXPO_PUBLIC_WEB_URL` (login-URL in
  staff-credential copy) must be provisioned for the mobile build.
- **RN date picker** that emits `YYYY-MM-DD` with a `max=today` cap, compatible with
  Expo 56 / RN 0.85 — needed by schedule (completedDate/target), members-settings
  (kickoff/target/start). Pin one component.
- **Offline mutation queue ownership:** does foundation provide a persisted/resumable
  react-query mutation outbox, or does each slice block writes offline? Specs diverge
  by surface (board wants optimistic+replay; schedule/brief/members deliberately
  *block*; card-detail blocks event-create but queues comments/members). Foundation
  must state whether the queue exists; slices opt in.

### 7.2 Server-side capabilities the anon client can't do
- **High-risk principal notification (`notifyPrincipalsOfHighRiskEvent`)** needs the
  service-role admin client; not callable from a mobile-created event. Proposal: a DB
  trigger or Supabase Edge Function on `card_events` insert for `HIGH_RISK_KINDS` so it
  fires client-agnostically. (card-detail, assistant.)
- **Draft-approval author notification (`notifyDraftApproved/Rejected`)** uses the
  admin client on web; mobile approvals won't notify unless we extract an anon-client
  notifications-core helper with an RLS insert policy on `notifications`, or defer.
  Confirm `notifications` RLS allows the approver to insert for the draft author.
  (brief-review.)
- **`recomputeProjectGates` is web-only (`"use server"`).** After a mobile-logged
  gate-relevant event or a mobile draft approval, is "next cron tick + realtime"
  acceptable for gate freshness, or is a non-web recompute entry point needed?
  (card-detail, schedule-gates, brief-review.)
- **Staff creation (`createStaffWithPassword`)** needs service-role. Decide option B
  (thin `/api/staff/create` route that authenticates the JWT, re-checks
  `canManageAccess`, then uses service-role — recommended for parity) vs option A
  (web-only; hide "Buat staf baru" in v1). (members-settings.)
- **Assistant LLM stays server-side.** Confirm `createSupabaseServerClient` honors
  `Authorization: Bearer` so mobile token-auth works against the existing assistant
  routes (a tiny server adjustment if not). (assistant.)
- **Areas suggest** keeps the cost-free prompt + Anthropic key server-side via
  `/api/areas/suggest` (Option A, recommended) — confirm. (rooms-areas.)

### 7.3 Realtime publication coverage
- **`area_gate_status`, `areas`, `card_areas` in `supabase_realtime`?** Web only
  published `cards/events/comments/topics` (migration `20260615000001`). Schedule and
  rooms need gate-status/areas live updates; if unpublished, fall back to
  refetch-on-focus + pull-to-refresh and file a publication migration.
  (schedule-gates, rooms-areas.)
- **Unread-badge channel dedupe:** if both the tab badge and the open notifications
  list subscribe, dedupe to one channel per `staffId` to avoid double increments.
  Decide whether the badge subscription lives at app-shell (always live) or only on
  the Inbox tab. (inbox.)

### 7.4 Streaming / transport
- **Expo 56 streaming fetch:** does `expo/fetch` expose `response.body` as an
  async-iterable byte stream for NDJSON? If not, fall back to `react-native-sse`/XHR
  `onprogress`. Verify against the v56 docs. (assistant.)

### 7.5 UX / scope decisions per slice
- **Move-card UX:** action-sheet target picker (matches web's no-DnD model) vs native
  drag-and-drop — spec recommends target picker v1. (projects-board.)
- **Gantt:** is the literal horizontal-scroll "Lini masa" segment in scope for v1, or
  ship only the per-area accordion ("Daftar")? Recommend accordion v1. (schedule.)
- **Reorder UX:** drag-to-reorder (recommended) vs editable `sort_order` — both funnel
  to the `reorder_project_areas` RPC. (rooms-areas.)
- **Mobile `/review` screen for draft links:** does it exist for
  `draft_pending`/`draft_rejected` notification links, or degrade to "buka di web"?
  (inbox depends on brief-review's review screen — sequence accordingly.)
- **"Current project" app state:** owned by the Matrix/projects-board slice's app
  state, or does the assistant tab ship its own minimal picker until that lands?
  (assistant.)
- **Search debounce interval** (250–350ms) given `searchAll` fires 6 sequential
  Supabase selects per call — confirm cost/latency feel during build. (search.)
- **Persist member/settings queries?** Currently excluded from `PERSISTED_KEY_ROOTS`;
  revisit if offline read of the member list proves valuable. (members-settings.)
- **Card-detail offline event-create:** spec blocks it (side effects unsafe to
  replay) — confirm. (card-detail.)
- **Self-removal / last-member removal** edge case: handle the subsequent RLS-denied
  refetch gracefully (bounce to landing) and ideally warn before self-removal.
  (members-settings.)

---

## 8. Verification gate (applies to every slice)

The strangler is only safe if web stays green at each repoint. For every extracted
module: run `pnpm --filter web typecheck && pnpm --filter web test` after the
repoint, and keep the named web unit tests passing unchanged (they re-import through
the re-export) — e.g. `optimistic-board-move.test.ts` (board),
`rooms-derive.test.ts` (rooms), `search-queries.test.ts` (search),
`notifications.test.ts` (inbox), and the overlay/rules/deadlines/brief/advisor unit
tests. Do not bundle multiple repoints into one commit. Mobile screens are covered
by `@testing-library/react-native` (jest-expo); core logic by vitest in
`packages/core`. CI runs both automatically once `@datum/core` + `apps/mobile` are
wired with `dependsOn ^build` in `turbo.json` (foundation).
