# Mobile Inbox (Notifications + Activity) — Design Spec

Slug: `inbox` · Date: 2026-06-20 · Target tab: `apps/mobile/app/(tabs)/inbox.tsx`

> Design doc only. No implementation code. Every behavior below is mirrored from a cited web file — nothing is invented.

---

## 1. Goal & scope

Bring the web app's two "what's happening" surfaces to mobile at full parity, under the existing **Inbox** tab:

1. **Notifications** — the per-staff in-app notification queue (`/notifications`): list of the 50 most recent, an unread/total summary, **mark one read**, **mark all read**, and tapping a notification deep-links to the referenced card.
2. **Unread badge (realtime)** — a live unread count surfaced on the Inbox tab icon, mirroring the web `NotificationBadgeClient` (optimistic +1 on INSERT, canonical refetch on UPDATE).
3. **Activity feed** — the studio-wide "Aktivitas Terbaru" stream (`/activity`): 50 most-recent card events + comments + new cards, merged and grouped by day.

In scope: notifications list, unread badge with realtime, mark-read (single + all), activity feed grouped by day, deep links into the card detail screen, loading/empty/error/offline states, react-query + AsyncStorage offline persistence, Supabase Realtime subscription, **and push notifications via `expo-notifications`** (v1 — locked 2026-06-20; see §11).

Out of scope for this slice: **producing** notifications (all `notify*` producers in `apps/web/lib/notifications/producers.ts` fire from the card-mutation god-module and belong to the card-event/draft slices, not Inbox), draft review actions (`/review` deep-link targets exist but the review screen is a separate slice), and the card detail screen itself (Inbox only deep-links into it). **Push notifications via `expo-notifications` are now IN scope for v1** (decision locked 2026-06-20) — see §11 for the design: a `push_tokens` table migration, device-token registration on login, and producer-side fan-out (server/admin client) alongside the existing in-app notification inserts.

---

## 2. Web behavior mirrored — exact files + functions

| Concern | Web file | Function / component | Behavior to mirror |
|---|---|---|---|
| Notifications page | `apps/web/app/(app)/notifications/page.tsx` | `NotificationsPage` (server component) | Fetches via `getRecentNotifications(supabase)`, renders header + `NotificationList`. Copy: title "Notifikasi", subtitle "@mention di komentar, aktivitas di kartu yang Anda tonton, dan status draft." |
| Notifications list + mark-read UI | `apps/web/components/notifications/NotificationList.tsx` | `NotificationList` | Empty state copy; summary line "`{unread}` belum dibaca dari `{items.length}` terbaru"; per-row KIND_LABEL chip; unread rows tinted (`--sand`/`--sand-tint`); "tandai dibaca" per unread row; "tandai semua dibaca" button when `unread > 0`; row links to `n.link`; timestamp `toLocaleString("id-ID", {dateStyle:"medium", timeStyle:"short"})`. `KIND_LABEL` map (mention→"Mention", watcher_event→"Aktivitas", card_status→"Status kartu", draft_pending→"Draft menunggu", draft_approved→"Draft disetujui", draft_rejected→"Draft ditolak", review_assigned→"Review ditugaskan"). |
| Recent notifications query | `apps/web/lib/notifications/queries.ts` | `getRecentNotifications(supabase, limit=50)` | `from("notifications").select("*").order("created_at",{ascending:false}).limit(50)`. Returns `Notification[]`. RLS scopes to recipient. |
| Unread count query | `apps/web/lib/notifications/queries.ts` | `getUnreadCount(supabase)` | `from("notifications").select("*",{count:"exact",head:true}).is("read_at",null)` → number. |
| Unread-count API | `apps/web/app/api/notifications/unread-count/route.ts` | `GET` | Returns `{ count }`, swallows errors to `0`. Web badge refetches this on realtime UPDATE. **Mobile replaces this HTTP round-trip with a direct `getUnreadCount(supabase)` call** (no API route needed; RLS does the same scoping). |
| Mark read (single) | `apps/web/lib/notifications/mutations.ts` | `markNotificationRead(formData)` | Validates `notificationId` is uuid; `update({read_at: now}).eq("id", id)`; `revalidatePath("/notifications")`. |
| Mark all read | `apps/web/lib/notifications/mutations.ts` | `markAllNotificationsRead()` | `update({read_at: now}).is("read_at", null)`; `revalidatePath("/notifications")`. |
| Unread badge (server) | `apps/web/components/notifications/NotificationBadge.tsx` | `NotificationBadge` | Gets `user.id`, seeds `initialCount` via `getUnreadCount`, renders client badge with `staffId`. |
| Unread badge (client, realtime) | `apps/web/components/notifications/NotificationBadgeClient.tsx` | `NotificationBadgeClient` | On INSERT → `count + 1` (optimistic); on UPDATE → refetch canonical count (guarded by `refreshing` flag); renders "99+" cap; aria-label "Notifikasi (N belum dibaca)". |
| Realtime subscription | `apps/web/lib/notifications/realtime.ts` | `subscribeToOwnNotifications(staffId, onDelta)` | Channel `notifications:${staffId}`; postgres_changes INSERT → `{kind:"insert"}`, UPDATE → `{kind:"refresh"}`; both filtered `recipient_staff_id=eq.${staffId}`; returns unsubscribe. |
| Activity page | `apps/web/app/(app)/activity/page.tsx` | `ActivityPage` | Fetches `getRecentActivity(supabase)`, groups by `toLocaleDateString("id-ID",{year,month:"long",day})`, renders day sections with "`{day} ({count})`" headers. Title "Aktivitas Terbaru", subtitle "50 aktivitas terbaru di semua proyek — kartu baru, aktivitas, dan komentar." Empty copy "Belum ada aktivitas." + hint. |
| Activity query | `apps/web/lib/activity/queries.ts` | `getRecentActivity(supabase)`, `summarizeEvent(kind, payload)`, types `ActivityItem`/`ActivityKind` | 3 parallel queries (card_events, card_comments where deleted_at null, cards), each `limit(50)`; map+merge; sort desc by `occurredAt`; slice to 50. Per-kind summary via `summarizeEvent`; comment body truncated to 120 chars + "…". |
| Activity row | `apps/web/components/activity/ActivityItem.tsx` | `ActivityItem` | KIND_LABEL (event→"aktivitas", comment→"komentar", card→"kartu baru") + KIND_COLOR; shows `eventKind ?? KIND_LABEL`, projectCode chip, timestamp + actor, card title link to `/project/{code}/cards/{slug}`, detail. |
| Type | `packages/db/src/index.ts` | `Notification` = `Tables["notifications"]["Row"]`, `NotificationKind` | Row shape: `id, recipient_staff_id, kind, project_id, card_id, card_event_id, card_comment_id, draft_id, actor_staff_id, summary, link, read_at, created_at`. |
| RLS | `packages/db/supabase/migrations/20260601000014_notifications.sql` | policies | select/update gated to `recipient_staff_id = current_staff_id()`. |

**Link-shape note:** all notification `link` values are web paths (`/project/{code}/cards/{slug}` or `/review`), built by the producers. Mobile must translate these into Expo Router routes (see §4 "Link mapping") — do **not** invent a new link column.

---

## 3. `@datum/core` surface to extract (the strangler step)

`@datum/core` does not exist yet (only `packages/db`, `packages/types`). This slice creates it and seeds it with the Inbox modules. **Hard rule reminder:** every export takes `SupabaseClient<Database>` as an argument; no `server-only`, no `next/*`, no React.

**Lucky starting point:** `getRecentNotifications`, `getUnreadCount`, and `getRecentActivity` are *already* pure `(supabase) => …` functions with zero web coupling. They move to core almost verbatim. The only web-coupled piece is `apps/web/lib/notifications/mutations.ts` (`"use server"` + `FormData` + `revalidatePath`); its DB logic is extracted to pure core functions and the web action becomes a thin wrapper.

### core/notifications/queries.ts
From `apps/web/lib/notifications/queries.ts` (verbatim move).
```ts
export function getUnreadCount(supabase: SupabaseClient<Database>): Promise<number>
export function getRecentNotifications(supabase: SupabaseClient<Database>, limit?: number): Promise<Notification[]>
```

### core/notifications/mutations.ts
Extract the DB writes from `apps/web/lib/notifications/mutations.ts` into pure, throw-on-error functions (no `FormData`, no `revalidatePath`). Validation via a shared Zod schema (see §6).
```ts
export const MarkReadInput: z.ZodObject<{ notificationId: z.ZodString }>
export function markNotificationRead(supabase: SupabaseClient<Database>, notificationId: string): Promise<void>   // update read_at=now .eq(id)
export function markAllNotificationsRead(supabase: SupabaseClient<Database>): Promise<void>                       // update read_at=now .is(read_at,null)
```

### core/notifications/realtime.ts
Extract `subscribeToOwnNotifications` from `apps/web/lib/notifications/realtime.ts`. Make it accept an injected client so web passes its browser client and mobile passes its anon client (current web version constructs the client internally — refactor to a param to stay isomorphic).
```ts
export type UnreadDelta = { kind: "insert" } | { kind: "refresh" }
export function subscribeToOwnNotifications(
  supabase: SupabaseClient<Database>,
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
): () => void
```

### core/activity/queries.ts
From `apps/web/lib/activity/queries.ts` (verbatim move incl. `summarizeEvent`, types `ActivityItem`, `ActivityKind`).
```ts
export type ActivityKind = "event" | "comment" | "card"
export type ActivityItem = { id; kind; occurredAt; projectCode; projectName; cardId; cardSlug; cardTitle; actor; detail; eventKind? }
export function getRecentActivity(supabase: SupabaseClient<Database>): Promise<ActivityItem[]>
```

### core/query/keys.ts (shared query-key factory)
Extend the web pattern in `apps/web/lib/query/keys.ts` with Inbox keys, hosted in core so web and mobile agree (per Locked Decision 1 + the brief's query-key note).
```ts
export const inboxKeys = {
  notifications: (staffId: string) => ["notifications", staffId] as const,
  unreadCount:   (staffId: string) => ["notifications", staffId, "unread"] as const,
  activity:      () => ["activity"] as const,
}
```

### How web repoints (verify web tests still pass)
- `apps/web/lib/notifications/queries.ts` → re-export from `@datum/core/notifications/queries` (keep the import path stable for existing callers like `NotificationBadge.tsx`, `unread-count/route.ts`, `notifications/page.tsx`).
- `apps/web/lib/notifications/realtime.ts` → thin wrapper that constructs `createSupabaseBrowserClient()` and forwards to `core` (preserves the current zero-arg-client call site in `NotificationBadgeClient.tsx`).
- `apps/web/lib/notifications/mutations.ts` → keep `"use server"`; `markNotificationRead`/`markAllNotificationsRead` parse `FormData`, call the core function, then `revalidatePath("/notifications")`. Web-only side effect stays in web.
- `apps/web/lib/activity/queries.ts` → re-export from `@datum/core/activity/queries`.
- `apps/web/lib/query/keys.ts` → keep `board/projects/card`; can additionally re-export `inboxKeys` from core (web doesn't use them today since notifications/activity are server-rendered, but hosting them in core sets the convention).
- Existing web test `apps/web/tests/unit/notifications.test.ts` (already references producers) and any query tests must stay green after the repoint — this is the verification gate for the strangler step.

**Producers are explicitly NOT extracted here.** `apps/web/lib/notifications/producers.ts` is consumed only by `apps/web/lib/cards/mutations.ts` (call sites at lines 285, 299, 401, 466, 763, 902, 987, 1034). They belong to the card-event/draft slices that own that god-module split. Inbox is read + mark-read only.

---

## 4. Mobile screens — Expo Router routes, NativeWind components, states

Expand the placeholder `apps/mobile/app/(tabs)/inbox.tsx` into a nested stack with a top **segmented toggle** (Notifikasi | Aktivitas) — RN parity for the web's two sibling routes, kept under one tab to match the locked tab set (Matrix/Inbox/Assistant/More).

```
apps/mobile/app/(tabs)/inbox/
  _layout.tsx        // Stack; default screen = index
  index.tsx          // InboxScreen: segmented control → <NotificationsView /> | <ActivityView />
```
Deep-link targets live in the **Matrix** slice's card stack (`/(tabs)/matrix/project/[code]/cards/[slug]`); Inbox only navigates there.

### Components (NativeWind, tokens from SANO shared source)
- `NotificationsView` — `FlatList<Notification>`; header summary "`{unread}` belum dibaca dari `{total}` terbaru" + "Tandai semua dibaca" action (rendered only when `unread > 0`).
- `NotificationRow` — kind chip (`KIND_LABEL` reused from web map), `summary`, relative/absolute timestamp (`id-ID` medium+short), unread tint (`--sand-tint`). `onPress` → resolve `link` → `router.push`. Trailing "Tandai dibaca" affordance on unread rows; swipe-to-mark-read is an enhancement (note, not required for parity). Min touch target 44pt (consistent with the web `min-h-11` touch-target work on this branch).
- `ActivityView` — `SectionList<ActivityItem>` with one section per day; section header "`{day} ({count})`" using `toLocaleDateString("id-ID",{year:"numeric",month:"long",day:"numeric"})`. Grouping logic mirrors `ActivityPage` exactly.
- `ActivityRow` — `eventKind ?? KIND_LABEL[kind]` chip + KIND_COLOR, `projectCode` chip, timestamp + actor, `cardTitle` (tap → card), detail. Mirrors `ActivityItem.tsx`.

### Link mapping (web path → Expo route)
A small `resolveNotificationLink(link: string)` helper in mobile:
- `^/project/(?<code>[^/]+)/cards/(?<slug>[^/]+)$` → `/(tabs)/matrix/project/{code}/cards/{slug}`
- `^/review$` → `/(tabs)/more/review` if a review screen exists; otherwise no-op + toast "Buka di web" (review is out of scope this slice).
- unmatched → no-op + dev warning. (All current producer links are one of these two shapes — see §2.)

### States (each view)
| State | Notifications | Activity |
|---|---|---|
| Loading (no cache) | Skeleton rows (3–5) | Skeleton section + rows |
| Loading (has cache) | Show persisted data, subtle top refresh spinner (stale-while-revalidate, `staleTime` from core client config) | Same |
| Empty | Mirror web: "Tidak ada notifikasi." + hint "Notifikasi muncul saat ada @mention, draft yang menunggu approval, atau aktivitas di kartu yang Anda tonton." | "Belum ada aktivitas." + hint "Buat kartu pertama atau tambah catatan di kartu yang sudah ada untuk mulai melihat aktivitas di sini." |
| Error | Inline card "Gagal memuat notifikasi." + "Coba lagi" (refetch); keep cached list visible if present | "Gagal memuat aktivitas." + "Coba lagi" |
| Offline (no cache) | "Tidak ada koneksi." + retry-on-reconnect note | Same |
| Offline (has cache) | Show cached list with a muted "Mode luring — data mungkin tidak terbaru" banner; mark-read queues (see §8) | Show cached list + offline banner (read-only; no mutations on activity) |

i18n: `apps/mobile/messages/{id,en}.json` currently only has a `login` block. Add `inbox.*` keys (Indonesian-first) mirroring the exact Bahasa strings above; web copy is the source of truth.

---

## 5. Data fetching — react-query keys, realtime, optimistic updates

Mobile must stand up the react-query stack that web has (`apps/web/lib/query/*`) but does not yet exist in `apps/mobile` (only `@react-native-async-storage/async-storage` is installed). Mirror `makeQueryClient()` config from `apps/web/lib/query/client.ts` (`staleTime 30_000`, `gcTime 24h`, `retry 1`, `refetchOnReconnect true`); `refetchOnWindowFocus` → use `AppState`-based `focusManager` (RN equivalent).

### Query keys (from core `inboxKeys`)
- `inboxKeys.notifications(staffId)` → `getRecentNotifications(supabase, 50)`
- `inboxKeys.unreadCount(staffId)` → `getUnreadCount(supabase)`
- `inboxKeys.activity()` → `getRecentActivity(supabase)`

### Realtime channel
- `core.subscribeToOwnNotifications(supabase, staffId, onDelta)`, channel `notifications:${staffId}` (identical to web). Wire once at the Inbox/tab level (and ideally app shell for the badge):
  - `onDelta {kind:"insert"}` → `setQueryData(unreadCount, c => c+1)` (optimistic, matches `NotificationBadgeClient`) **and** `invalidateQueries(notifications)` so the new row shows when the list is open.
  - `onDelta {kind:"refresh"}` → `invalidateQueries(unreadCount)` + `invalidateQueries(notifications)` (web refetches the canonical count via API; mobile refetches via the same `getUnreadCount`).
- Activity has **no** realtime in web; mobile mirrors that — refresh on focus/pull-to-refresh only (avoids subscribing to three high-traffic tables; consistent with web's "don't poll a board nobody is viewing").

### Unread badge on the tab
Surface the count on the Inbox `Tabs.Screen` (`tabBarBadge`) in `apps/mobile/app/(tabs)/_layout.tsx`, fed by the `unreadCount` query (seeded from cache, kept live by the realtime subscription). "99+" cap mirrors web.

### Optimistic updates (mark-read)
- **Mark one:** `onMutate` → snapshot, set that row's `read_at` to now in the `notifications` cache, decrement `unreadCount`. `onError` → rollback. `onSettled` → invalidate both keys. Mirrors web's optimistic-by-`revalidatePath` outcome but client-side.
- **Mark all:** `onMutate` → set every unread row's `read_at`, set `unreadCount` to 0. Rollback/settle as above.

---

## 6. Mutations & validation — reuse Zod from `@datum/core`

- `MarkReadInput` Zod schema (`{ notificationId: uuid }`) lives in `core/notifications/mutations.ts` and is the single source for both web's `FormData` parse and mobile's call. Mobile validates the id before calling `markNotificationRead(supabase, id)`.
- Mobile calls `core.markNotificationRead(supabase, id)` and `core.markAllNotificationsRead(supabase)` directly with its anon client — **no server action, no `FormData`, no `revalidatePath`** (those are web-only side effects that stay in the web wrapper). RLS enforces that only the recipient can update (`notifications_update` policy).
- These are the only writes Inbox performs. Activity is read-only.

---

## 7. RLS & permissions notes (per role)

From `20260601000014_notifications.sql`:
- **notifications.select** / **notifications.update**: `recipient_staff_id = current_staff_id()`. Every staff role (principal/designer/pic/site_supervisor/admin/estimator) sees and marks **only their own** notifications — role-agnostic. Mobile needs no client-side role gating for notifications; RLS is sufficient and identical to web.
- **Activity** (`getRecentActivity`) reads `card_events`, `card_comments`, `cards`, joined to `projects`/`staff`. Visibility is whatever the existing project/card RLS allows for the calling role; the activity query itself adds no extra gate. Cross-project-read roles (principal/admin/estimator per producers.ts) will see more rows than a designer scoped to their projects — this is inherited from existing RLS, mirrored exactly, not changed here.
- Mobile uses the **anon client** (`apps/mobile/lib/supabase/client.ts`) with the AsyncStorage-persisted session; the authenticated JWT drives `current_staff_id()` / `auth.uid()` server-side. No service-role key on device (the `notifyPrincipalsOfHighRiskEvent` admin path is producer-side and not in this slice).
- `staffId` for keys/channel = `supabase.auth.getUser().id` (web uses `user.id` in `NotificationBadge.tsx`; same on mobile).

---

## 8. Offline behavior

Mirror web's persistence (`apps/web/lib/query/{persister,idb-kv,client}.ts`) with an **AsyncStorage persister** (Locked Decision 3). Reuse the isomorphic `createKVPersister(kv, key)` from `apps/web/lib/query/persister.ts` — its `AsyncKV` interface (`getItem/setItem/removeItem`) maps 1:1 to AsyncStorage. (Consider moving `persister.ts` to `@datum/core/query` too so both apps share the exact persister; web's `idb-kv.ts` stays web-only as the IndexedDB-backed `AsyncKV`.)

- Persist roots: notifications + activity (analogous to web's `PERSISTED_KEY_ROOTS`). Add `"notifications"`, `"activity"` to the persisted roots used by the mobile persister's `dehydrate` filter.
- `CACHE_BUSTER` + `CACHE_MAX_AGE` (24h) mirrored from `client.ts`. On logout, clear the AsyncStorage cache (mobile analog of `clearIdbCache()`) so a shared studio device leaks nothing — matches the existing security intent in `idb-kv.ts`.
- **Reads offline:** last-fetched notifications/activity render from persisted cache with an offline banner.
- **Mark-read offline:** optimistic cache update applies immediately; the Supabase write is retried on reconnect (react-query mutation retry + `refetchOnReconnect`). If the app is killed before flush, the realtime UPDATE on next launch reconciles the canonical count (same self-healing path web relies on). Keep it best-effort — no heavyweight mutation-queue persistence required for a single-column `read_at` flip.
- **Realtime gap:** while offline, INSERT/UPDATE deltas are missed; on reconnect, `refetchOnReconnect` re-pulls both queries, closing the gap (web has the same property).

---

## 9. Edge cases

- **No staff row / not signed in:** `staffId` null → render nothing/empty (mirror `NotificationBadge.tsx` `staffId ?? null` guard); the root layout already redirects unauthenticated users to login.
- **Unread count drift:** optimistic +1 on INSERT can drift from server truth; the UPDATE→refetch path (and focus refetch) reconcile, exactly as `NotificationBadgeClient` does.
- **99+ cap** on the badge.
- **Dangling links:** a notification whose card was deleted — `link` still resolves to a route; the card screen handles the not-found state (its slice). Inbox just navigates.
- **`/review` links** (`draft_pending`, `draft_rejected`) with no mobile review screen yet → graceful no-op + "buka di web" toast (§4).
- **Timezone/locale:** all dates formatted `id-ID` to match web (`toLocaleString`/`toLocaleDateString`); RN Hermes Intl must be confirmed to support `id-ID` (note: if Hermes lacks full ICU, day-grouping keys could differ — verify on device, fall back to a fixed formatter if needed).
- **Comment truncation:** activity comment detail truncates at 120 chars + "…" (in core, shared) so web and mobile match.
- **Duplicate notifications:** producers already dedup recipients; Inbox renders whatever rows exist, keyed by `id`.
- **Empty after mark-all:** summary line + "tandai semua" disappear when `unread === 0` (mirror `NotificationList`).
- **Realtime double-subscribe:** if both the tab badge and the open list subscribe, dedupe to one channel per `staffId` to avoid double increments.

---

## 10. Testing

**Vitest (core logic, in `packages/core`):**
- `getUnreadCount` / `getRecentNotifications` — query shape, limit, ordering (mock `SupabaseClient`). Port the existing approach from `apps/web/tests/unit/notifications.test.ts`.
- `markNotificationRead` / `markAllNotificationsRead` — correct `update`/`eq`/`is` calls, throws on error; `MarkReadInput` rejects non-uuid.
- `getRecentActivity` — 3-query merge, dedup of null-project rows, desc sort, 50-cap; `summarizeEvent` for each `event_kind` branch (table-driven).
- `subscribeToOwnNotifications` — channel name, filters, INSERT→insert / UPDATE→refresh mapping, unsubscribe.
- `inboxKeys` — stable key tuples.
- **Strangler regression gate:** existing web unit tests (`apps/web/tests/unit/notifications.test.ts` + any activity/query tests) must pass unchanged after web repoints to core.

**@testing-library/react-native (screens):**
- `NotificationsView` — loading / empty / error / populated; unread tint; summary line; "tandai semua" visible only when `unread > 0`; tap mark-one → optimistic read state + count decrement; tap row → `router.push` to mapped route.
- `ActivityView` — day grouping + headers with counts; empty state; row chips/labels.
- Badge — INSERT increments, UPDATE triggers refetch, 99+ cap.
- Offline — cached render + banner; mark-read optimistic while offline.
- `resolveNotificationLink` — both link shapes + unmatched no-op.

---

## 11. Dependencies on other slices + Out of scope

**Depends on:**
- **Mobile app-shell / query infra slice** (or this slice bootstraps it): react-query provider, `makeQueryClient`, AsyncStorage persister, `focusManager`/`onlineManager` wiring, NativeWind + SANO token source. If no shell slice owns it, Inbox stands up the minimal version and the shell slice later absorbs it.
- **Matrix / card-detail slice** — owns the deep-link target `/(tabs)/matrix/project/[code]/cards/[slug]`. Inbox navigates to it; until it exists, taps can land on a placeholder.
- **`@datum/core` package creation** — first slice to create it must add `package.json`, tsconfig path alias in `tsconfig.base.json`, and the `core/*` module layout. If another slice already created core, this slice only adds the `notifications/`, `activity/`, `query/` modules.

**Out of scope (explicit):**
- **Notification producers** (`apps/web/lib/notifications/producers.ts`) and the `cards/mutations.ts` god-module split — owned by card-event/draft slices.
- **Draft review screen** (`/review` target) — separate slice; Inbox degrades gracefully.
- **Card detail screen** — Matrix slice.
- **Web-only side effects** (`revalidatePath`, the `/api/notifications/unread-count` route) — stay web-side; mobile calls core directly.
- **Push notifications via `expo-notifications`** — **parity stretch, scoped not built.** Sketch for a later slice: register the Expo push token on login, persist it on the `staff` row (or a new `push_tokens` table — needs a DB migration, out of scope here), and add a server-side fan-out in the **producers** (i.e. the producer slice, not Inbox) that sends a push whenever it inserts a `notifications` row. Foreground notification handler would invalidate the `unreadCount`/`notifications` queries; tapping a push deep-links via the same `resolveNotificationLink`. Requires `expo-notifications` per the v56 docs (https://docs.expo.dev/versions/v56.0.0/), EAS credentials (APNs/FCM), and a permissions prompt — none of which this read-only Inbox slice introduces.
