# Mobile — Card detail (timeline, comments, attachments, members)

**Date:** 2026-06-20
**Status:** Design spec — ready for review
**Slug:** `card-detail`
**Area:** apps/mobile (Expo Router) · new `@datum/core` package · strangler of apps/web/lib/cards

This slice brings the web **card detail** screen to mobile at full parity for the
light, day-to-day actions. It is the second-biggest read/write surface after the
board, and it is where the strangler migration of the 1090-line
`apps/web/lib/cards/mutations.ts` god-module formally begins.

---

## 1. Goal & scope

Deliver a native card-detail screen reachable from the Matrix (board) tab that:

- **Views the activity timeline** — every `card_events` row, newest-first, with
  the same per-kind summary phrasing the web uses, the high-risk badge, extracted
  URLs, and the one-tap "resolve open loop" action for open decisions / client
  requests.
- **Views attachments with AI captions** — image thumbnails / file chips per
  event, the `ai_status` lifecycle (analyzing / caption / re-analyze), and signed
  URLs for download/preview.
- **Adds activity** — the per-kind `AddEventForm` equivalent (9 kinds, dynamic
  fields, optional date, optional attachment upload).
- **Discusses** — comment list with @mention decoration, add / edit / soft-delete
  (own comments only).
- **Manages members** — add (watcher) / remove card members from the project
  staff list.

**In scope:** read of card header + timeline + attachments + comments + members;
the write actions listed above (`createCardEvent`, `attachToEvent`,
`signAttachment`, `reanalyzeAttachment`, `createComment`, `editComment`,
`deleteComment`, `resolveCardEvent`, `addCardMember`, `removeCardMember`).

**Out of scope (own slices):** move card between columns (`moveCard`), card areas
(`getCardAreas` / area-link mutations), card links (`CardLinks` /
`link-mutations`), the draft/approval flow (`createCardEventDraft` /
`approveCardEventDraft` / `rejectCardEventDraft` — these belong to the CATAT /
Review slices), `updateCard` (title/summary/status editing — belongs to the card
header / edit slice), and print. See §11.

---

## 2. Web behavior mirrored — exact files & functions

Everything below is grounded in the web implementation. The mobile screen
replicates this behavior; it does not invent new behavior.

### Page composition
- `apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx` — server component
  that resolves the project by `project_code`, calls
  `getCardWithTimelineByProjectCode`, then fan-out loads attachments / members /
  comments / staff / topics / areas / links, and seeds the react-query cache with
  `initialCard: CardPayload = { ...detail, comments, members }`.
- `apps/web/components/board/CardDetailClient.tsx` — client wrapper that reads the
  card from `useCard(code, slug, initialCard)`, subscribes **once** via
  `subscribeToProjectChanges(projectId, …)` and invalidates `keys.card(code, slug)`
  on any change. Lays out a main column (header, add-event, timeline, comments) +
  a sidebar (move, members, areas, links).

### Queries (`apps/web/lib/cards/queries.ts`)
- `getCardWithTimelineByProjectCode(supabase, projectCode, cardSlug)` → joins
  `cards` to `projects!inner(project_code)`, then `getTimelineEvents` (private):
  `card_events.select("*").eq("card_id").order("occurred_at", desc)`.
- `getCardWithTimeline(supabase, projectId, cardSlug)` — same, keyed by projectId.
- `getCardAttachments(supabase, cardId)` → two-query: event ids for the card, then
  `card_attachments.in("card_event_id", …)`, returned as `Map<eventId, CardAttachment[]>`.
- `getCardComments(supabase, cardId)` → `card_comments` where `deleted_at is null`,
  `order(created_at asc)`.
- `getCardMembers(supabase, cardId)` → `card_members.select("*, staff:staff_id(id,full_name,role)")`
  where `removed_at is null`, `order(added_at asc)`. Returns `CardMemberWithStaff[]`.
- `getProjectStaff(supabase, projectId)` → active `staff` (id, full_name, role),
  alphabetical — the "addable members" candidates.

### Mutations (`apps/web/lib/cards/mutations.ts`) — the strangler targets
- `createCardEvent(formData)` — Zod-validates `eventKind` + `payload_*` fields via
  `EventPayloadSchemas[kind]`, inserts `card_events` (stamps `logged_by_staff_id`,
  `source_kind:"manual"`, `cost_visible` from `COST_VISIBLE_KINDS`), fire-and-forget
  `recomputeProjectGates` for `GATE_RELEVANT_KINDS`, then
  `notifyWatchersOfEvent` + (`HIGH_RISK_KINDS`) `notifyPrincipalsOfHighRiskEvent`.
  Helper `collectPayload` coerces `amount|percent_complete|quantity`→number,
  `attendees`→string[].
- `attachToEvent(formData)` — inserts a `card_attachments` row (storage_path,
  mime_type) after the file is uploaded.
- `signAttachment(formData)` — `storage.from("card-attachments").createSignedUrl(path, 600)`.
- `reanalyzeAttachment(formData)` — resets `ai_status:"pending", ai_attempts:0, ai_error:null`.
- `createComment(formData)` — parses `@first-name` tokens → resolves active staff
  by case-insensitive first-name match → inserts `card_comments` with `mentions[]`
  → `notifyMentions`.
- `editComment(formData)` — re-parses mentions, updates `body`, `edited_at`,
  `mentions`, `notifyMentions`.
- `deleteComment(formData)` — soft delete: sets `deleted_at`.
- `addCardMember(formData)` — upsert: un-remove a soft-removed row else insert
  (role default `"watcher"`).
- `removeCardMember(formData)` — soft remove: sets `removed_at`.
- `resolveCardEvent(formData)` — RPC `resolve_card_event(p_event_id, p_new_status, p_reason)`
  (atomic payload update + `record_revisions` audit). newStatus enum:
  `needs_decision|decided|superseded|open|answered`.

### Presentation components
- `apps/web/components/board/AddEventForm.tsx` — `KIND_LABELS`, `KIND_ORDER`,
  `FIELDS_BY_KIND` (the per-kind field maps), file picker (image/* + pdf, 20MB),
  optional date, and the post-save flow: invalidate `keys.card`, upload each file
  via `uploadCardAttachment`, then `attachToEvent` per file.
- `apps/web/components/board/EventRow.tsx` — `summarize(ev)` (per-kind one-liner),
  `extractUrls` + `looksLikeImage` + `safeHostname`, the high-risk badge, and
  `ResolveAction` (renders only when `isDecisionOpen` / `isClientRequestOpen`).
- `apps/web/components/board/EventAttachments.tsx` — resolves signed URLs, image
  thumbnail vs file chip, and the AI-status footer: "Menganalisis…" for
  pending/processing, the `ai_caption` for done, an "Analisis ulang" button for
  failed/skipped (with `ai_error` as the title/tooltip).
- `apps/web/components/board/CommentsSection.tsx` + `CommentItem.tsx` —
  `renderBody` decorates `@mention` tokens; per-item edit / confirm-delete; the
  edit/delete affordances show only when `canEdit` (own comment).
- `apps/web/components/board/CardMembers.tsx` — member chips (tap to remove),
  "+ tambah" reveals addable staff (candidates minus current members).

### Upload + attachment understanding
- `apps/web/lib/cards/upload.ts` — `uploadCardAttachment` uploads to the
  `card-attachments` bucket at `${projectId}/${cardId}/${cardEventId}/${uuid}-${safeName}`.
- `apps/web/lib/attachments/analyze.ts` — `attachmentKind`, `attachmentSkipReason`,
  `MAX_ATTACHMENT_BYTES` (20MB), the describe prompt + vision call. **Server-only
  (imports `@anthropic-ai/sdk`); not extracted.** Mobile only triggers the queue
  (insert with `ai_status:"pending"`) and re-queue; the existing Vercel cron runner
  on web does the actual vision call.

### Notifications (`apps/web/lib/notifications/producers.ts`)
- `notifyMentions`, `notifyWatchersOfEvent` (+ `shouldNotifyWatchers` gate),
  `notifyPrincipalsOfHighRiskEvent` (uses **service-role admin client**).

---

## 3. `@datum/core` surface to extract (the strangler step)

Create the new package `@datum/core` per LOCKED DECISION 1. **Hard rule:** every
export takes `SupabaseClient<Database>` as its first arg; no `server-only`, no
`next/*`, no React. Add path aliases to `tsconfig.base.json`:
`"@datum/core": ["./packages/core/src"]`, `"@datum/core/*": ["./packages/core/src/*"]`.

This slice extracts **only** what card-detail needs. Notifications producers move
too, but with a caveat (below). Each web `apps/web/lib/cards/*` module is then
repointed to re-export / delegate to core, and web tests must still pass.

### 3.1 Reads — `core/cards/queries.ts`
Move verbatim (they already take `supabase` and are isomorphic):

```ts
export type CardDetail = { card: Card; events: CardEvent[] };
export type CardMemberWithStaff = CardMember & { staff: Pick<Staff,"id"|"full_name"|"role"> | null };

export async function getTimelineEvents(supabase: SC, cardId: string): Promise<CardEvent[]>;
export async function getCardWithTimeline(supabase: SC, projectId: string, cardSlug: string): Promise<CardDetail>;
export async function getCardWithTimelineByProjectCode(supabase: SC, projectCode: string, cardSlug: string): Promise<CardDetail>;
export async function getCardAttachments(supabase: SC, cardId: string): Promise<Map<string, CardAttachment[]>>;
export async function getCardComments(supabase: SC, cardId: string): Promise<CardComment[]>;
export async function getCardMembers(supabase: SC, cardId: string): Promise<CardMemberWithStaff[]>;
export async function getProjectStaff(supabase: SC, projectId: string): Promise<Pick<Staff,"id"|"full_name"|"role">[]>;
```
*(SC = `SupabaseClient<Database>`.)* `getBoardForProject` / `mapBoardBundle` /
`getProjectTopics` stay where the board slice extracts them — do not move them here
to avoid churn. **Web repoint:** `apps/web/lib/cards/queries.ts` re-exports these
from `@datum/core/cards/queries`.

### 3.2 The shared card payload + AI helpers
- `core/cards/payload.ts` — host `CardPayload` (today inferred in the web API
  route) as an explicit type so web and mobile agree:
  ```ts
  export type CardPayload = CardDetail & { comments: CardComment[]; members: CardMemberWithStaff[] };
  ```
  Web repoint: `apps/web/app/api/card/[code]/[slug]/route.ts` imports `CardPayload`
  from core instead of self-inferring.
- `core/attachments/kinds.ts` — extract the **pure** helpers from
  `lib/attachments/analyze.ts`: `attachmentKind`, `attachmentSkipReason`,
  `MAX_ATTACHMENT_BYTES`, `attachmentKind`'s `AttachmentKind` type. **Do not move**
  `describeAttachment` / `buildDescribeMessages` (they import `@anthropic-ai/sdk`
  and the web assistant client — server-only). Web repoint: `analyze.ts` imports
  the pure helpers from core, keeps the vision call.

### 3.3 Mutations — split the god-module into focused core modules
Each becomes a pure function taking `supabase` + a **typed args object** (not
`FormData` — `FormData`/Zod parsing stays in the thin web action / mobile call
site). Return the same result shapes.

```ts
// core/cards/events/create.ts
export type CreateCardEventArgs = {
  cardId: string; projectId: string; eventKind: EventKind;
  payload: Record<string, unknown>; occurredAt?: string; loggedByStaffId: string;
};
export type CreateCardEventResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string; fieldErrors?: Record<string,string> };
export async function createCardEvent(supabase: SC, args: CreateCardEventArgs): Promise<CreateCardEventResult>;
//   validates via EventPayloadSchemas[kind], inserts card_events,
//   sets source_kind:"manual", cost_visible from COST_VISIBLE_KINDS,
//   and returns the new event id. Side effects (gate recompute, notifications)
//   stay OUT — see note below.

// core/cards/events/resolve.ts
export type ResolveEventArgs = { eventId: string; newStatus: ResolveStatus; reason?: string };
export async function resolveCardEvent(supabase: SC, args: ResolveEventArgs): Promise<{ok:true}|{ok:false;error:string}>;
//   calls rpc("resolve_card_event", …). RPC + RLS do the auth + audit.

// core/cards/attachments.ts
export async function attachToEvent(supabase: SC, args: {cardEventId:string; storagePath:string; mimeType:string}): Promise<...>;
export async function signAttachment(supabase: SC, storagePath: string): Promise<{ok:true;url:string}|{ok:false;error:string}>;
export async function reanalyzeAttachment(supabase: SC, attachmentId: string): Promise<{ok:true}|{ok:false;error:string}>;
export function attachmentStoragePath(a: {projectId:string; cardId:string; cardEventId:string; fileName:string}): string;
//   ^ the path-building from upload.ts, made pure & shared (mobile uploads via
//     its own supabase.storage call; the path scheme MUST match web's bucket layout).

// core/cards/comments.ts
export function extractMentionTokens(body: string): string[];                 // the @first-name regex, shared
export async function resolveMentionStaffIds(supabase: SC, tokens: string[]): Promise<string[]>;
export async function createComment(supabase: SC, args: {cardId:string; projectId:string; body:string; createdByStaffId:string}): Promise<{ok:true; commentId:string; mentions:string[]}|{ok:false;error:string}>;
export async function editComment(supabase: SC, args: {commentId:string; body:string}): Promise<{ok:true; cardId:string; projectId:string; mentions:string[]}|{ok:false;error:string}>;
export async function deleteComment(supabase: SC, commentId: string): Promise<{ok:true}|{ok:false;error:string}>;

// core/cards/members.ts
export async function addCardMember(supabase: SC, args: {cardId:string; staffId:string; role:CardMemberRole; addedByStaffId:string}): Promise<{ok:true}|{ok:false;error:string}>;   // upsert / un-remove
export async function removeCardMember(supabase: SC, args: {cardId:string; staffId:string; role:CardMemberRole}): Promise<{ok:true}|{ok:false;error:string}>;
```

**Notifications boundary (important).** `notifyPrincipalsOfHighRiskEvent` needs a
**service-role admin client** (it reads principal/admin staff rows the caller
can't see under RLS) — that is server-only and CANNOT run from the mobile anon
client. So:
- Move the **anon-client-safe** producers to `core/notifications/producers.ts`:
  `notifyMentions`, `notifyWatchersOfEvent` (+ `shouldNotifyWatchers`),
  `notifyCardStatusChange`, `notifyDraft*`. These only insert `notifications`
  rows the caller's RLS already permits.
- Keep `notifyPrincipalsOfHighRiskEvent` **server-only in web** (it constructs the
  admin client). Mobile-created high-risk events therefore won't fire the
  principal spot-check notification directly from the device. **Open question (§ open):
  resolve via DB trigger or an Edge Function** so the principal notification fires
  server-side regardless of client. For now the watcher fan-out + the existing
  realtime + Inbox slice still surface the event; the principal-only courtesy ping
  is the single piece that needs a server hook.
- The `createCardEvent` core fn returns the event id; the **caller** orchestrates
  side effects: web action keeps `recomputeProjectGates` + the full notification
  set + `revalidatePath`; mobile calls the anon-safe `notifyWatchersOfEvent` then
  invalidates its react-query cache. Gate recompute (`recomputeProjectGates`) is
  web-only (it hits a web route) — mobile relies on the next cron tick + realtime.

### 3.4 Shared query keys — `core/query/keys.ts`
Host the key factory so web and mobile agree (web's `apps/web/lib/query/keys.ts`
re-exports):
```ts
export const keys = {
  board: (code:string)=>["board",code] as const,
  projects: ()=>["projects"] as const,
  card: (code:string, slug:string)=>["card",code,slug] as const,
};
export const PERSISTED_KEY_ROOTS = ["board","projects","card"] as const;
```

---

## 4. Mobile screens — Expo Router routes + components + states

### Routes (nested stack under the Matrix tab, per LOCKED DECISION 4)
```
app/(tabs)/(matrix)/_layout.tsx                         Stack
app/(tabs)/(matrix)/index.tsx                           projects list (existing matrix.tsx, moved in)
app/(tabs)/(matrix)/project/[slug].tsx                  board (other slice)
app/(tabs)/(matrix)/project/[slug]/card/[cardSlug].tsx  ← THIS SLICE (card detail)
```
The card-detail route reads `slug` (project_code) + `cardSlug` from
`useLocalSearchParams`. It is also deep-linkable from the Inbox tab (a notification
`link` like `/project/{code}/cards/{slug}` maps to this route).

### Layout (single column — phones; web's 2-col sidebar collapses into stacked
sections, exactly as web does at `<md`):
1. **Header bar** — back chevron → board, `{topicName} · Detail Kartu`, card title +
   status. (Topic name + edit affordances are minimal here; full header editing is
   a separate slice. Display only.)
2. **Timeline** section — `Timeline` (FlatList of `EventRow`s, newest first).
3. **Add activity** — a button that opens an `AddEventBottomSheet` / modal screen.
4. **Diskusi** section — comment list + `CommentInput`.
5. **Anggota kartu** — member chips + add-member sheet.

### Key NativeWind components (new, mirror the web component names)
- `CardDetailScreen` — orchestrates `useCard`, the realtime subscription, and the
  section layout. Mirrors `CardDetailClient`.
- `Timeline` + `EventRow` — `EventRow` reuses `summarize`, `extractUrls`,
  `looksLikeImage`, `safeHostname` (extract these tiny pure helpers into
  `core/cards/event-render.ts` so RN and web share them — currently inline in
  `EventRow.tsx`). High-risk pill, URL chips (open via `Linking.openURL`),
  `ResolveAction` button (uses `isDecisionOpen` / `isClientRequestOpen` from
  `@datum/types`).
- `EventAttachments` + `AttachmentTile` — image thumb via RN `<Image source={{uri}}>`
  from the signed URL; file chip otherwise; AI footer (analyzing / caption /
  "Analisis ulang"). Tapping opens the signed URL (`Linking.openURL` or in-app
  viewer).
- `AddEventForm` (modal/bottom sheet) — `KIND_ORDER` picker, `FIELDS_BY_KIND`
  rendered as RN inputs (text / multiline / numeric keyboard / date picker /
  Picker / csv), optional date, attachment picker via `expo-image-picker` +
  `expo-document-picker`.
- `CommentsSection` / `CommentItem` / `CommentInput` — list, `@mention`
  decoration (reuse `extractMentionTokens`), own-comment edit / confirm-delete.
- `CardMembers` — chips + add sheet.

### Every state
| Section | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| Whole screen | skeleton header + 3 skeleton rows while `useCard` has no cached data | n/a (card always exists if route resolved) | "Kartu tidak ditemukan" + back-to-board link (mirrors web `detailRes` rejected branch) | render last-cached `CardPayload` from AsyncStorage; banner "Mode luring — perubahan tertunda" |
| Timeline | inline spinner row | "Belum ada aktivitas." | toast + keep cached events | cached events shown read-only-ish; new events queue |
| Attachments | per-tile "(memuat…)" until signed URL resolves | n/a (only render if event has attachments) | tile shows filename, no thumb; AI footer may show "Analisis ulang" | thumbnails fail gracefully → filename chip; signed-URL fetch deferred |
| AddEvent | submit button "Menyimpan…" / "Mengupload…" | n/a | inline `error` + per-field `fieldErrors` (from Zod) | block submit with "Tidak bisa menyimpan saat luring" (events are not safely queueable — see §8) |
| Comments | "Menyimpan…" on submit | "Belum ada komentar. Mulai diskusi di bawah. Gunakan @nama…" | inline error | optimistic add allowed (see §8) |
| Members | chip disabled during pending | "belum ada" / "semua staf sudah jadi anggota" | inline error | optimistic toggle |

Copy is Indonesian-first, sourced from `apps/mobile/messages/{en,id}.json` (extend
the existing files — currently only `login.*`). Reuse the exact strings the web
uses ("Tambah aktivitas", "Timeline aktivitas", "Diskusi", "Anggota kartu",
"Tandai diputuskan", "Tandai terjawab", "Analisis ulang", "Menganalisis…", etc.).

---

## 5. Data fetching — react-query keys, realtime, optimistic updates

Per LOCKED DECISION 3, mobile uses `@tanstack/react-query` with an AsyncStorage
persister mirroring web's idb-keyval persistence, and Supabase Realtime.

### Query
- `useCard(code, slug)` — `queryKey: keys.card(code, slug)` (from `@datum/core/query/keys`).
  Unlike web (which fetches `/api/card/...`), **mobile's `queryFn` calls
  `@datum/core` directly** with the anon client and assembles `CardPayload`:
  ```ts
  const detail = await getCardWithTimelineByProjectCode(supabase, code, slug);
  const [comments, members] = await Promise.all([
    getCardComments(supabase, detail.card.id),
    getCardMembers(supabase, detail.card.id),
  ]);
  return { ...detail, comments, members } satisfies CardPayload;
  ```
  RLS enforces auth (same guarantee the web API route's `auth.getUser()` provides).
- **Attachments** — a separate query `["card", code, slug, "attachments"]` calling
  `getCardAttachments(supabase, cardId)` once the card id is known (web loads it in
  the RSC and passes `attachmentsByEvent` down; on mobile a dependent query is
  cleaner and lets it refetch on the `event`/`attachment` realtime signal).
- **Staff candidates** — `["project", projectId, "staff"]` → `getProjectStaff`.

### Realtime
Reuse web's channel shape. Extract `subscribeToProjectChanges(projectId, onChange)`
into `core/cards/realtime.ts` (today it lives in `apps/web/lib/cards/realtime.ts`
and uses the browser client + `window.setTimeout`). The core version must take the
supabase client as an arg and use a platform-neutral debounce (`setTimeout` exists
in RN too; just drop the `window.` prefix). The mobile screen subscribes once and
invalidates `keys.card(code, slug)` (+ the attachments query) on any
`card | event | comment | topic` change — exactly like `CardDetailClient`. Add an
`AppState` listener so the channel resubscribes on foreground.

### Optimistic updates
- **Comment add/edit/delete** — mutate the cached `CardPayload.comments` array
  immediately (web does a hard invalidate; mobile improves UX with optimistic +
  rollback on error, then invalidate to reconcile). Stamp a temp id; replace with
  the server `commentId`.
- **Member add/remove** — optimistic chip toggle on `CardPayload.members`, then
  invalidate (matches `CardMembers`' invalidate-on-success).
- **Resolve event** — optimistically patch the event's `payload.status`; the
  resolve button disappears (driven by `isDecisionOpen`/`isClientRequestOpen`).
- **Create event** — append optimistically is risky (Zod field errors, attachment
  upload can fail mid-flow). Mirror web: on success, **invalidate** `keys.card`
  (web does `queryClient.invalidateQueries(keys.card(...))` right after the event
  insert, before uploads). No optimistic insert for events.

---

## 6. Mutations & validation — reuse Zod from `@datum/types` / `@datum/core`

- **Event payloads:** validate against `EventPayloadSchemas[kind]` from
  `@datum/types` (already isomorphic — pure zod). The mobile `AddEventForm` builds
  a `payload` object (numbers for `amount|percent_complete|quantity`, `string[]` for
  `attendees` — reuse `collectPayload`'s coercion, extracted into
  `core/cards/events/collect-payload.ts` so it isn't re-implemented). Call
  `core.createCardEvent(supabase, args)`. On `fieldErrors`, surface per-field
  (mirrors web).
- **Comment body:** `min(1).max(4000)` — mirror `CreateCommentInput`. Mention
  extraction via shared `extractMentionTokens`.
- **Member role:** enum `owner|watcher|assignee` (`CardMemberRole`); mobile adds as
  `watcher` like web's `CardMembers`.
- **Resolve status:** enum `needs_decision|decided|superseded|open|answered`. The UI
  only offers `decided` (decision) / `answered` (client_request), matching
  `ResolveAction`.
- **Attachment upload:** mobile uploads via its own
  `supabase.storage.from("card-attachments").upload(path, blob, {contentType})`,
  where `path = attachmentStoragePath({projectId, cardId, cardEventId, fileName})`
  (shared with web's scheme). Then `core.attachToEvent(...)`. New rows default to
  `ai_status:"pending"`; the existing web cron runner captions them.

After each mutation the mobile caller fires the **anon-safe** notification
producer where web does (`notifyMentions` on comment, `notifyWatchersOfEvent` on
event) and invalidates the card query. See §3.3 for the high-risk-principal caveat.

---

## 7. RLS & permissions notes (per role)

All access is RLS-enforced server-side; the mobile anon client gets the same gates
as the web server client. Roles: **principal, designer, staff** (DB also has
admin/estimator for cross-project reads).

- **Read** (`getCardWith…`, comments, members, attachments): allowed for staff who
  can read the project (project-membership RLS). Cost-sensitive vendor amounts are
  governed by `cost_visible` + the cost-role RLS already in place — mobile inherits
  it; do not render amounts the query didn't return.
- **createCardEvent:** any project member may insert `card_events` (the board
  already lets members add activity). `logged_by_staff_id` stamped to the caller.
- **Comments:** any project member may create; **edit/delete gated to the author**
  (`canEdit = currentStaffId === comment.created_by_staff_id`, mirrored from web).
  RLS must also enforce author-only update/soft-delete — the UI gate is not the
  security boundary.
- **Members:** add/remove follows the `card_members` RLS (project membership).
- **resolveCardEvent:** the `resolve_card_event` RPC enforces who may resolve;
  surface its error verbatim.
- **reanalyzeAttachment:** RLS gates the update to attachments whose parent event is
  in an accessible project (per the web comment in `mutations.ts`).
- **High-risk principal notification:** requires service-role; **not callable from
  the device** — see §3.3 open question. No RLS workaround (by design the anon
  client must not read other principals' staff rows).

`currentStaffId` on mobile = `supabase.auth.getUser()` id (same as web's
`user?.id`), used for the comment edit/delete gate and self-mention filtering.

---

## 8. Offline behavior

Mirror web's idb-keyval offline persistence with an AsyncStorage persister
(LOCKED DECISION 3); `PERSISTED_KEY_ROOTS` includes `"card"`, so the last-viewed
card payload survives app restarts and renders instantly offline.

- **Reads:** render the cached `CardPayload` + cached attachments when offline.
  Signed URLs (10-min TTL) will be stale offline — image tiles fall back to the
  filename chip; AI captions (plain text, cached in the payload) still show.
- **Comments:** queue an optimistic comment in the cache; flag it "pending kirim";
  flush on reconnect (react-query retry / a small mutation queue). Edits/deletes
  likewise.
- **Members:** queue the toggle optimistically; reconcile on reconnect.
- **Create event:** **do not queue offline.** Events carry side effects (gate
  recompute, watcher/principal notifications, attachment upload) that are unsafe to
  replay blindly and whose validation (`EventPayloadSchemas`) and notifications run
  server-adjacent. Block the submit with "Tidak bisa menyimpan saat luring" and keep
  the form open. (Matches the web reality that event creation is an online action.)
- **Attachments:** upload requires connectivity; if offline at upload time, surface
  the same "Upload gagal" path web uses and leave the form open.

---

## 9. Edge cases

- **Card not found / project not found:** mirror the web page — show "Kartu tidak
  ditemukan: {cardSlug}" with a back-to-board link (the `getCardWith…` throws on
  missing card; catch and render the error state).
- **Retired event kinds** (`survey|vendor_quote|vendor_pick|worker_assigned|progress|
  defect|pending`): `summarize` + `KIND_LABEL` already handle these for historical
  rows; the mobile `EventRow` must keep the same fallthrough so old timelines render.
- **Decision lifecycle defaulting:** `DecisionPayload`'s transform sets `status`
  from `approved_by`; logging an already-approved decision must not show a "Tandai
  diputuskan" button. Rely on `isDecisionOpen` (handles legacy rows lacking `status`).
- **@mention with no match:** token that resolves to no active staff → no
  notification, comment still saves (web behavior).
- **Self-mention:** filtered out of notifications (`notifyMentions` drops
  `id === actorId`).
- **HEIC/HEIF images:** allowed in the bucket but the vision API skips them
  (`ai_status:"skipped"`); the tile shows "Analisis ulang". On iOS, `expo-image-picker`
  may hand back HEIC — set it to convert to JPEG where possible so captions work.
- **Oversize file (>20MB):** `attachmentSkipReason` returns "oversize"; the bucket
  also rejects. Validate client-side before upload and show a clear message.
- **Attachment with `ai_status` failed + `ai_error`:** show "Analisis ulang"; expose
  `ai_error` (web uses it as the button title — on mobile show it as helper text or
  on long-press, since there's no hover).
- **Signed-URL expiry mid-session:** if a thumbnail 403s, re-sign on demand.
- **Comment edited then realtime echoes back:** the realtime invalidate refetches;
  reconcile optimistic state to avoid flicker.
- **Long timelines:** FlatList virtualization; web fetches all events unpaginated —
  match for parity now, note pagination as future work if a card grows large.

---

## 10. Testing

- **Core logic — vitest** (in `packages/core`, runnable in the existing workspace
  test setup; these are the strangler's safety net):
  - `createCardEvent`: valid payload per kind inserts + returns id; invalid payload
    returns `fieldErrors`; `cost_visible` set for vendor; `source_kind:"manual"`.
  - `collectPayload` coercion: numbers, attendees csv→array, empty fields dropped.
  - `extractMentionTokens` + `resolveMentionStaffIds`: case-insensitive first-name
    match, dedup, no-match → empty.
  - `createComment` / `editComment` / `deleteComment`: insert with mentions,
    edited_at set, soft-delete sets deleted_at.
  - `addCardMember` upsert: un-removes a soft-removed row vs inserts new.
  - `resolveCardEvent`: calls the rpc with the right args.
  - `attachmentStoragePath`, `attachmentKind`, `attachmentSkipReason` pure-fn tests.
  - `summarize` / `extractUrls` / `isDecisionOpen` / `isClientRequestOpen` over the
    full kind matrix incl. retired kinds.
  - Use a mocked `SupabaseClient<Database>` (the functions are pure given the
    client) — same pattern the existing web query/mutation tests use.
- **Web regression:** after repointing `apps/web/lib/cards/{queries,mutations}.ts`
  to core, the existing web vitest + e2e (board-cache) suites must still pass —
  this is the strangler acceptance gate.
- **Mobile screens — @testing-library/react-native:**
  - Timeline renders events newest-first; high-risk badge appears for high-risk
    kinds; resolve button shows only for open decision/request.
  - AddEventForm: switching kind swaps fields; submitting an invalid required field
    shows the field error; numeric fields use numeric keyboard.
  - CommentItem: edit/delete affordances appear only for own comments; @mention is
    decorated.
  - AttachmentTile: "(memuat…)" → thumbnail; AI states (analyzing / caption /
    re-analyze) render off `ai_status`.
  - States: loading skeleton, not-found error, offline banner.
  - Mock supabase + react-query; assert query keys and optimistic cache writes.

---

## 11. Dependencies on other slices + Out of scope

### Depends on
- **`@datum/core` bootstrap** — this slice creates the package, but the **board
  slice** and **mobile-shell slice** (react-query provider + AsyncStorage persister
  + NativeWind tokens + tabs→stacks navigation) are prerequisites for the screen to
  mount. If those land first, reuse their provider/persister; otherwise this slice
  must stand up a minimal one. Coordinate the `core/query/keys.ts` ownership with
  the board slice (shared file).
- **mobile-shell** — NativeWind token source (LOCKED DECISION 2), the react-query
  client + realtime resubscribe-on-foreground plumbing.
- **inbox slice** — provides the deep link into this route from a notification
  `link`.

### Out of scope (explicit — these are other slices)
- **Move card** (`moveCard`, `MoveCardControl`), **card areas** (`getCardAreas`,
  `area-link-*`, `CardAreas`), **card links** (`CardLinks`, `link-mutations`,
  `link-queries`) — the sidebar's other panels.
- **Card header editing** (`updateCard`, `CardHeader`: title/summary/status) and
  **status-change notifications** (`notifyCardStatusChange`).
- **Draft / approval flow** (`createCardEventDraft`, `approveCardEventDraft`,
  `rejectCardEventDraft`, the `/review` screen, `notifyDraftPending/Approved/Rejected`)
  — belongs to CATAT / Review.
- **The vision/caption runner itself** (`describeAttachment`, the Vercel cron) —
  stays server-only; mobile only enqueues / re-enqueues.
- **Card creation** (`createCard`) and **topic creation** (`createTopic`) — board slice.
- **Print** (`/cards/[cardSlug]/print`).

### Open questions
- How does a **mobile-created high-risk event** fire the principal spot-check ping
  (`notifyPrincipalsOfHighRiskEvent`) without a service-role client? Proposal: a
  DB trigger or Supabase Edge Function on `card_events` insert where
  `event_kind ∈ HIGH_RISK_KINDS`, so it's client-agnostic. Until decided, mobile
  high-risk events rely on watcher fan-out + realtime + Inbox only.
- Does **`recomputeProjectGates`** need a non-web entry point, or is "next cron tick
  + realtime" acceptable for gate freshness after a mobile-logged event? (Web
  recomputes inline via a web route; mobile can't call it.)
- Should **event creation be queueable offline** at all, or is blocking offline the
  right call given side effects? (Spec currently blocks — confirm.)
- Confirm `core/query/keys.ts` **ownership** so board + card slices don't both
  create it.
