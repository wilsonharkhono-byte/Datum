# DATUM Mobile App (Expo) — UX Audit

**Date:** 2026-07-17
**Scope:** `apps/mobile` — full native-app comfort audit (6 dimensions: touch/layout, photo journey, navigation/deep links, offline/resilience, keyboard, list performance)
**Method:** 6 parallel Sonnet auditors → dedup → every Critical/High claim adversarially verified by an independent Opus agent instructed to refute. Severities below are the **post-verification** ratings; several findings were honestly downgraded from the auditors' claims (noted inline).

## Summary

| Severity (final) | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 24 |
| Low | 6 |
| **Total** | **31** |

**Fixed on this branch (feat/mobile-share-to-card):** V-1 (signed URLs — the one true High), plus the photo-journey and touch-comfort Mediums marked ✅ below.
**Logged for follow-up:** camera capture, push-tap routing, offline mutation resume, realtime refetch-on-recover, and the remaining Medium/Low polish items.

## Verified findings (were claimed Critical/High; every one CONFIRMED by an adversarial verifier)

### V-1 [High] (downgraded from Critical) — Attachment thumbnails use the raw storage_path as the Image URI instead of a signed URL — photos will never render in the timeline
**File:** `components/card/EventRow.tsx:147`  ·  **Dimension:** -

AttachmentItem renders `<Image source={{ uri: storage_path ?? undefined }} .../>` directly from the CardAttachment row (line 147). `storage_path` is not a URL — per packages/core/src/cards/attachments.ts `attachmentStoragePath()` (lines 15-24) it's a bare bucket-relative path like `${projectId}/${cardId}/${cardEventId}/${uuid}-${safeName}` with no scheme. Core already exports `signAttachment()` (attachments.ts lines 65-74) which calls `supabase.storage.from('card-attachments').createSignedUrl(...)` to produce a real https URL, and the web app's EventAttachments.tsx (lines 20-33) explicitly calls it before rendering any `<img>`/`<a>`. Mobile's EventRow never imports or calls signAttachment anywhere, and useCardAttachments/getCardAttachments (packages/core/src/cards/queries.ts lines 74-99) just returns raw DB rows unmodified. Expo Image cannot load a schemeless string, so every photo attached via AddEventForm or the new share-to-card flow will show as a broken/blank image in the card timeline.

**Fix:** In EventRow (or a wrapper/hook), resolve each attachment's storage_path to a signed URL via the existing core signAttachment(supabase, storagePath) before passing it to <Image source>, mirroring web's EventAttachments pattern (batch-resolve with a loading placeholder while signing).

**Verifier notes:** Confirmed. EventRow.tsx:147 (inside AttachmentItem) passes the raw CardAttachment.storage_path directly to expo-image: `<Image source={{ uri: storage_path ?? undefined }} .../>`. attachmentStoragePath() (packages/core/src/cards/attachments.ts:15-24) returns a schemeless bucket-relative path like `${projectId}/${cardId}/${cardEventId}/${uuid}-${safeName}` — no https scheme, not loadable by expo-image. getCardAttachments (packages/core/src/cards/queries.ts:74-101) returns raw rows unmodified via the useCardAttachments hook (apps/mobile/lib/query/hooks.ts:95). The web counterpart (apps/web/components/board/EventAttachments.tsx:26-33) proves the intended contract: it signs every storage_path via signAttachment (createSignedUrl, 10-min TTL) before rendering <img>. A grep of apps/mobile/ shows signAttachment is never imported or called anywhere in mobile, so no existing mechanism resolves the path. Net: image attachment thumbnails in the mobile card timeline will render blank/broken.

Severity honestly downgraded Critical -> High: this is a broken core surface (photo documentation is central to this app), but the user is NOT blocked from a core task. Non-image attachments still render the paperclip tile, and for image rows the sibling ai_caption / "Menganalisis..." text still renders next to the broken thumbnail, so the timeline remains navigable and readable. No crash, no data loss, no security impact — the defect is a silently failing image on a 360px phone, not a task blocker. Still a genuine must-fix bug.

Proposed fix is sound: resolve each storage_path to a signed URL via the existing core signAttachment(supabase, storagePath) before passing to <Image source>, mirroring web's batch-resolve-with-placeholder pattern. One implementation note for the fixer: signed URLs have a 10-min TTL and a fresh URL each resolve, which will defeat expo-image's uri-keyed cache and require re-signing on remount — acceptable, but worth memoizing/keying to avoid re-fetching on every render.

### V-2 [Medium] (downgraded from Critical) — Photo upload failure is silently swallowed — warning is set then instantly wiped, form closes, photo is lost
**File:** `components/card/AddEventForm.tsx:267`  ·  **Dimension:** -

In handleSubmit (lines 240-286), after the event is saved, if pendingAsset is set the code calls uploadCardAttachment and on failure calls setAttachWarning(...) (line 276). But immediately after, unconditionally, it calls setOpen(false) and resetForm() (lines 284-285), and resetForm() (lines 210-216) itself calls setAttachWarning(null). Both setAttachWarning calls happen synchronously within the same handler tick, so React batches them and the final state is attachWarning=null — the warning text set at line 276 is never visible to the user. On top of that, setOpen(false) collapses the whole form back to the '+ Catat aktivitas' button, hiding any residual state. The net effect: on a failed/oversize/unsupported upload (very plausible on-site with flaky Android data and 20MB photos), the user sees the form close as if everything succeeded, the photo is gone, and there is no retry affordance at all.

**Fix:** Do not call resetForm() unconditionally after a failed attachment upload. Only reset/close on full success; on upload failure, keep the form open, keep pendingAsset so the user can retry, and show the warning without immediately clearing it (e.g. move setAttachWarning after resetForm, or branch: on failure, skip setOpen(false)/resetForm() and instead show a retry button for the same pendingAsset).

**Verifier notes:** Mechanism verified in AddEventForm.tsx. On a failed/skipped attachment upload, line 276 sets attachWarning, then lines 284-285 unconditionally call setOpen(false) + resetForm(); resetForm() (line 214) calls setAttachWarning(null). Final state is attachWarning=null, and the warning Text (line 386) only renders while open===true, so setOpen(false) hides it regardless. pendingAsset is cleared, so no retry affordance. The warning-on-failure contract stated in the file/module headers is silently defeated. This part of the finding is accurate.

Severity downgraded from Critical to Medium because the finding overstates impact: (1) the card event itself still saves successfully (mutation completed at lines 252-260 before this block) — only the photo attachment is lost, and the user is never blocked; (2) the photo is picked from the device gallery via launchImageLibraryAsync (pick-and-upload.ts line 53), NOT captured-and-discarded, so the source image remains on the phone and is re-attachable — the finding's "the photo is gone" is false; (3) attachments are best-effort by explicit design. Real harm is a silently dropped attachment with no feedback on flaky connections — a legitimate correctness/UX bug, but recoverable and non-blocking, hence Medium.

Fix caveat: the proposed fix is directionally correct but must NOT simply leave the form open for the user to press Simpan again — the event was already created at line 252, so re-running handleSubmit would double-create the event. The retry must re-invoke only uploadCardAttachment against the existing eventId. Implement as a dedicated retry-upload path, and move/guard the setAttachWarning so it survives (don't call resetForm on the failure branch).

### V-3 [Medium] (downgraded from Critical) — Tapping a push notification never routes anywhere
**File:** `lib/notifications/push.ts:24`  ·  **Dimension:** -

registerForPushNotificationsAsync() only requests permission and persists the Expo push token (upsertPushToken). There is no `Notifications.addNotificationResponseReceivedListener` / `getLastNotificationResponseAsync` call anywhere in the codebase (verified by repo-wide grep for these APIs across app/ and lib/ — zero hits outside this file's token registration). The in-app inbox screen (app/(tabs)/inbox.tsx lines 60-78) has a working `parseLink()` that maps a notification's web `link` to the matching mobile route, but it is only invoked from `NotificationRow`'s onPress when the user is already inside the app looking at the Inbox list. When a readiness reminder, @mention, or draft-approval push arrives and the field user taps the OS notification tray while the app is backgrounded or killed, nothing consumes the notification payload's `link`/data — the app simply opens to whatever screen React Navigation restores (or the default Matrix tab), completely discarding the destination.

**Fix:** Add a `Notifications.addNotificationResponseReceivedListener` (plus `getLastNotificationResponseAsync` for the cold-start case) in the root layout or session provider, reuse the existing `parseLink()` logic (hoist it to a shared module, e.g. lib/notifications/deep-link.ts, and import it from both inbox.tsx and the new listener) to turn the notification's data payload into a route, and call `router.push()`/`router.replace()` once the session is authenticated.

**Verifier notes:** CODE FACTS CONFIRMED. lib/notifications/push.ts (registerForPushNotificationsAsync, lines 24-67) only requests permission + persists the Expo token via upsertPushToken; it installs no tap handler. Repo-wide grep across app/ and lib/ for addNotificationResponseReceivedListener / getLastNotificationResponseAsync / useLastNotificationResponse / NotificationResponse returns ZERO hits (only test mocks reference the registration fn). parseLink() (app/(tabs)/inbox.tsx lines 60-78) is invoked ONLY from NotificationRow.onPress (line 113), i.e. when the user is already in the Inbox list. registerForPushNotificationsAsync is called fire-and-forget from lib/session/session.tsx line 42; nothing else in the app consumes a tapped notification's payload. The backend DOES ship a destination: apps/web/app/api/cron/readiness-reminders/route.ts line 155 sends data: { link: intent.link } via apps/web/lib/notifications/push-send.ts, so the payload carries a link that the mobile app silently discards on OS-tray tap. The proposed fix is technically sound for Expo SDK 56 (addNotificationResponseReceivedListener + getLastNotificationResponseAsync/useLastNotificationResponse for cold start, hoist parseLink to a shared module, gate on auth, router.push). One implementation note: the listener must read response.notification.request.content.data.link (not a top-level `link`), then run parseLink on it.

SEVERITY DOWNGRADED Critical -> Medium (honest): (1) Push is not operational yet — app.json expo.extra is {} with no EAS projectId (TODO(push) still open at push.ts line 43); registerForPushNotificationsAsync returns null at line 46 before ever calling getExpoPushTokenAsync, so no device token is persisted and ZERO push notifications are currently delivered. MEMORY confirms mobile-parity-build's remaining work is "EAS projectId + on-device smoke test." No field user is harmed today. (2) Even once push goes live, tapping a notification still launches/foregrounds the app normally — no crash, no data loss, no security impact. The notification is DB-backed and appears in the Inbox tab with a fully working deep-link, so the destination is reachable in ~2 extra taps (open app -> Inbox -> tap row). This is a degraded-UX / missing-deep-link gap, not a blocker. The finding's phrase "completely discarding the destination" is accurate for the tap-to-route path but overstated as user harm since the notification content itself is not lost. Genuine, worth fixing before push is enabled, but Medium — not Critical.

### V-4 [Medium] (downgraded from Critical) — Schedule, Rooms, Settings, Members, Brief, Search and Review screens have no in-app entry point
**File:** `app/(tabs)/(matrix)/project/[slug]/schedule.tsx:1`  ·  **Dimension:** -

These fully-built screens are unreachable by tapping anything in the app: repo-wide greps for `router.push`/`<Link`/`href=` referencing `.../schedule`, `.../rooms`, `.../settings`, `.../members`, `matrix)/search`, or `matrix)/brief` return zero results in app/ or components/ (confirmed against the full source of app/(tabs)/(matrix)/project/[slug]/index.tsx, which has no header button, menu, or footer tab linking to any of them). `schedule`, `rooms`, `settings`, and `members` are reachable only via the inbox notification-tap `parseLink()` mapping — i.e. only if a notification happens to carry that link AND the user is viewing the in-app Inbox list (the OS push-tap path is itself broken, see the push.ts finding). `brief.tsx` and `search.tsx` have zero references anywhere in app/ or components/ outside their own file and are entirely dead code from a navigation standpoint; `review.tsx` is reachable only from inside `brief.tsx` (itself unreachable) or from an inbox notification link. In practice, field staff have no way to view the project schedule/Gantt, manage rooms & areas, edit project settings, manage members, search, or see the daily brief/review queue through normal tapping.

**Fix:** Add a persistent navigation surface for the project-scoped screens — e.g. a header overflow menu or segmented tab bar on the project board screen (index.tsx) linking to Jadwal/Ruangan/Anggota/Pengaturan — and a global entry point (tab bar icon or Matrix-tab header button) for Search and Brief/Review, so every built screen has at least one discoverable path from the tab root.

**Verifier notes:** Factual core CONFIRMED, but Critical is overstated — downgrade to Medium.

VERIFIED: The project board screen app/(tabs)/(matrix)/project/[slug]/index.tsx has no navigation surface — its Stack.Screen sets only title/headerBackTitle/headerTitleStyle (no headerRight), and the body is BoardFilter + BoardTabs + a horizontal FlatList of columns with no link to schedule/rooms/settings/members. Repo-wide there is no Drawer/Menu/overflow/headerRight anywhere in app/ or components/. The four tabs are (matrix), inbox, assistant, (more); (more) is only profile+signOut; the (matrix) root is a project list that reaches the board only. Chat Citation/ProposalCard push only to card detail.

The finding actually UNDERSTATES it for two screens: inbox.tsx parseLink() maps only cards, (schedule|rooms), and review — it does NOT map settings or members. So settings has zero tap entry point (not even inbox), and members is reachable only from the unreachable settings screen. brief.tsx and search.tsx have no inbound references (dead from a nav standpoint); review is reachable from brief (dead) or an inbox review notification.

WHY NOT CRITICAL: The core loop (project list → board → card → create card → assistant → inbox) is fully usable. schedule and rooms ARE reachable via the Inbox tab: parseLink routes /project/{code}/schedule (readiness reminders) and /project/{code}/rooms (AI-block notifications), and Inbox is a first-class tab with a live unread badge. Readiness reminders are the product's flagship notification stream (project memory), so notification-tap → schedule is the intended primary entry, not a lucky accident — 'field staff have no way to view the schedule' is overstated. Inline search also exists on the project list and BoardFilter, softening the dedicated-search gap. The genuinely dead-ends are settings, members, brief, and the dedicated global search screen — a real completeness/discoverability gap for secondary/admin screens, but not a blocker of the core mobile workflow (settings/member management is occasional and has full web parity). This is Medium, not Critical.

FIX SANITY: Proposed fix is correct — add a headerRight overflow menu on the board's Stack.Screen (options.headerRight) linking to Jadwal/Ruangan/Anggota/Pengaturan, plus a global entry (Matrix header button or tab) for Search and Brief/Review. Technically straightforward in expo-router; no concerns.

### V-5 [Medium] (downgraded from Critical) — Offline-queued mutations restored from disk are never resumed — silent data loss on app restart
**File:** `lib/query/provider.tsx:25`  ·  **Dimension:** -

PersistQueryClientProvider (lines 24-39) persists both the query cache and the mutation cache to AsyncStorage. TanStack's default `shouldDehydrateMutation` persists any mutation whose `state.isPaused` is true, and every write in lib/query/mutations.ts uses the default networkMode ('online'), so a mutation fired while offline pauses in memory waiting for connectivity — exactly the flaky-outdoor-network scenario this app targets. If the app is backgrounded and reclaimed by the OS, or force-closed/restarted before signal returns, PersistQueryClientProvider restores the paused mutation from AsyncStorage on next launch, but nothing in the codebase (grep for `resumePausedMutations` across apps/mobile returns zero hits) ever calls `queryClient.resumePausedMutations()`. Per TanStack's own persist-client docs, that call is required after restore or the mutation just sits dehydrated forever — it never re-executes, never surfaces an error, and the UI gives no sign after restart that the action was lost. The user believes their comment/event/gate-pass was saved but it silently never reached Supabase.

**Fix:** Add an `onSuccess` prop to `PersistQueryClientProvider` that calls `client.resumePausedMutations()` (then invalidate the relevant query roots so screens refresh with the mutation's effect). Alternately/additionally, surface a persistent 'pending changes' indicator so a lost-on-restart mutation is at least visible to the user instead of silently vanishing.

**Verifier notes:** Mechanism verified but severity overstated (Critical -> Medium), and the proposed fix does not actually work.

VERIFIED FACTS:
- provider.tsx (lines 25-35) passes dehydrateOptions overriding only shouldDehydrateQuery, so TanStack's default shouldDehydrateMutation (m.state.isPaused) stays active -> paused mutations DO get persisted to AsyncStorage.
- No networkMode anywhere; makeQueryClient (packages/core/src/query/client.ts) only configures `queries`, so writes default to 'online' and pause when offline.
- Zero resumePausedMutations calls in apps/mobile (grep confirmed). So restored paused mutations are never resumed.
- Offline-pause path is reachable for non-optimistic writes: components/card/CommentInput.tsx, components/card/AddEventForm.tsx, components/schedule/GateAdvanceSheet.tsx, and inbox mark-read do NOT gate on onlineManager.isOnline() (grep count 0), unlike settings.tsx/members.tsx which disable writes offline.

WHY MEDIUM, NOT CRITICAL:
1. Narrow trigger: loss needs a write fired while offline AND the app force-closed/OS-reclaimed BEFORE connectivity returns. The app wires onlineManager.setEventListener to NetInfo (provider.tsx lines 9-11), so if signal returns while the app is alive, react-query auto-resumes paused mutations and the write lands — no loss. That covers the common flaky-network case.
2. Impact is a single lost write requiring re-entry, not data corruption or multi-user damage.
3. "User believes it was saved" is partly overstated: while paused the mutation is in pending state (no success confirmation fires), and an OfflineBanner is shown on these screens, so the user has a network-down signal at submit time. The genuinely silent window is only after a restart.

FIX IS WRONG (important): The proposed onSuccess: client.resumePausedMutations() will NOT re-execute these writes. No mutation sets a mutationKey and there is no queryClient.setMutationDefaults() anywhere (grep confirmed). TanStack requires both so a rehydrated mutation can recover its mutationFn — the mutationFn is an un-serializable closure and is lost across the AsyncStorage round-trip. After restore, resumePausedMutations() finds the mutation but has no function to run, so nothing reaches Supabase. The honest remediation is either (a) register mutationKey + setMutationDefaults for every write plus resumePausedMutations on restore, or (b) simpler and safer: set shouldDehydrateMutation: () => false to stop persisting un-resumable mutations and add a visible pending/error state so a lost offline write is surfaced rather than silently dropped.

### V-6 [Medium] (downgraded from High) — "Tandai selesai" gate-complete button is far below the 44px touch target
**File:** `components/schedule/AreaGateCard.tsx:113`  ·  **Dimension:** -

The GateRow advance button (the primary write action of the whole Schedule screen — marking a construction gate as passed) is `className="mt-1 rounded border border-ok/50 bg-ok-bg px-2 py-0.5 active:opacity-70"` with `text-[11px]` and no min-height. py-0.5 = 2px top/bottom padding, so the effective tap height is roughly 18-20px. It sits stacked directly under a Badge in a tight `items-end gap-1` column (line 110), so there is no extra buffer around it either. Compare to GateAdvanceSheet's own footer Button which correctly uses `min-h-[44px]` (Button.tsx line 10) — this is an inconsistency within the same feature.

**Fix:** Add `min-h-[44px]` (and ideally `min-w-[100px]`) to the Pressable's className, or wrap the existing small pill in a larger invisible hit area via `hitSlop={{top:12,bottom:12,left:8,right:8}}`.

**Verifier notes:** Cited code is accurate: components/schedule/AreaGateCard.tsx:113-120 renders the "Tandai selesai" advance Pressable with className "mt-1 rounded border border-ok/50 bg-ok-bg px-2 py-0.5 active:opacity-70" and text-[11px], no min-height and no hitSlop. Effective tap height is ~18-20px (11px text * ~1.3 line-height + 2px top/bottom padding + 1px borders), well under 44px. It sits in a tight items-end gap-1 (4px) column directly under a non-interactive Badge (line 110-111), so no buffer. The inconsistency claim checks out: components/ui/Button.tsx:10 uses min-h-[44px]. No global hitSlop/wrapper mechanism exists to compensate.

Severity downgraded from High to Medium because the impact is overstated: (1) The user is not blocked — the button is tappable, just small and fiddly, so the cost is mis-taps and retries, not inability to complete the action. (2) A mis-tap lands on the adjacent non-interactive Badge, which does nothing, rather than triggering a wrong write. (3) onAdvance routes into GateAdvanceSheet (a confirmation sheet with its own 44px footer button), so even a landed tap does not immediately commit the irreversible gate advance — there is a downstream confirmation gate. So the defect is ergonomic frustration on a small target, not a blocked-or-harmed scenario that would justify High.

Proposed fix is sound. Between the two options, hitSlop={{top:12,bottom:12,left:8,right:8}} is the better choice: it expands the hit area to ~44px while preserving the compact pill's visual size and the stacked layout, whereas min-h-[44px] would visually inflate the pill and stretch the tight column. Either resolves the WCAG 2.5.8 / platform touch-target shortfall.

### V-7 [Medium] (downgraded from High) — "Simpan"/"Batal" add-card buttons are ~18px tall — smallest touch targets in the board's most-used flow
**File:** `components/board/AddCardForm.tsx:73`  ·  **Dimension:** -

Once a user taps "+ tambah kartu" (line 39, correctly `min-h-[44px]`), the follow-up confirm/cancel row uses `px-3 py-1` with `text-[10px]` and no min-height (lines 76 and 97), giving an effective height of roughly 16-18px. This is the primary card-creation action in the board — the single most frequent write flow in the app — and it renders inside a Column that is itself inside a nested ScrollView (Column.tsx line 23), so a mis-tap near the boundary can also scroll instead of submit.

**Fix:** Add `min-h-[44px]` to both Pressables (matching AddColumnSlide/MobileAddEventForm's own "Simpan"/"Batal" pattern, which do use min-h-[44px] elsewhere in the app), or at minimum apply `hitSlop`.

**Verifier notes:** Code confirms the claim: AddCardForm.tsx lines 76 and 97 use `px-3 py-1` + `text-[10px]` with no min-height and no hitSlop, yielding ~20-22px-tall confirm/cancel buttons (finding's "16-18px" is slightly low but same order; both well under the 44px used everywhere else in the app, e.g. AddEventForm.tsx 399/416, Button.tsx, and this file's own line-45 trigger). The inconsistency is real and worth fixing.

Downgraded from High to Medium because the impact framing is overstated. The primary card-creation submit is NOT gated on the tiny button: line 65-66 wires onSubmitEditing={submit} with returnKeyType="done" and the input autoFocuses (line 59), so the keyboard is already up and the most-frequent write completes via the full-size keyboard "done" key. The small Pressable is a secondary path. "Batal" (cancel) is the only action with no alternative, but it's low-stakes/infrequent. The "mis-tap scrolls instead of submits" concern is largely a non-issue: RN's tap/scroll disambiguation treats a stationary tap as a press, not a scroll, so mis-taps don't silently scroll. No 360px-Android field user is blocked or harmed — this is a target-size/consistency polish issue (WCAG 2.5.5), not a broken flow.

Proposed fix is correct: add `min-h-[44px] items-center justify-center` to both Pressables to match AddEventForm's Simpan/Batal pattern; hitSlop is an acceptable minimum. Recommend keeping CONFIRMED at Medium.

### V-8 [Medium] (downgraded from High) — Area reorder up/down arrows are ~24x24px and stacked with only 2px between them
**File:** `components/areas/AreaManagerRow.tsx:220`  ·  **Dimension:** -

The move-up/move-down Pressables (lines 220-229 and 230-239) use `className="items-center justify-center rounded p-1 active:opacity-60 disabled:opacity-30"` around a 14px glyph — roughly a 22-24px square — and the two are stacked in a `View className="gap-0.5"` (line 219), i.e. only ~2px apart. On a 360px-wide phone, in a settings/CRUD screen used to reorder rooms in the field, this is a high-risk fat-finger pair: it's easy to hit the wrong arrow, and there's no confirmation before the reorder mutation fires.

**Fix:** Give each arrow `min-h-[44px] min-w-[44px]` (or at least 36px with hitSlop) and increase the gap between them, or replace with a single drag-handle / long-press reorder pattern.

**Verifier notes:** Code matches the finding exactly. Line 219 `View className="gap-0.5"` = 2px gap; lines 220-239 both reorder Pressables use `p-1` (4px) padding around a `text-[14px]` glyph with no hitSlop, giving ~22-26px squares. These are below Android 48dp/iOS 44pt guidance and only borderline pass WCAG 2.5.8's 24px floor, with sub-spec spacing — a genuine touch-target defect, so the finding is CONFIRMED, not refuted.

Severity downgraded from High to Medium because the impact is overstated: (1) reorder is non-destructive and trivially reversible — a mis-tap just moves the row one slot the wrong way and the user taps the other arrow to undo; no data loss, no blocked flow, so a 360px-Android field user is annoyed, not harmed or blocked. (2) The finding frames "no confirmation before the reorder mutation" as risk, but the actually-destructive control (delete) IS confirmation-gated via Alert.alert in confirmDelete (lines 92-105/270-279). (3) `isReordering`/`isMutating` disable BOTH arrows during the mutation (lines 222/232), preventing rapid compounding mis-taps.

Proposed fix is directionally correct: hitSlop (or ~36px + hitSlop) is the right lightweight remedy and the finding allows it. Caveat: the literal `min-h-[44px] min-w-[44px]` on both stacked arrows would push each row to ~88px+ tall in a dense CRUD list — hitSlop / a single drag-handle is preferable to hardcoded 44px squares here.

### V-9 [Medium] (downgraded from High) — No full-screen/zoom viewer for attachment photos — thumbnails are dead-end 64x64 tiles
**File:** `components/card/EventRow.tsx:139`  ·  **Dimension:** -

AttachmentItem (lines 139-167) renders the image at a fixed 64x64 with no Pressable/onPress, no modal, no navigation to a full-screen viewer. Web's equivalent (apps/web/components/board/EventAttachments.tsx line ~70) at least wraps the image in an `<a href={signedUrl} target="_blank">` so users can open it full-size. On mobile there is no way at all to inspect a site photo in detail (e.g. read a marble sample label, check a crack, verify grout color) — the user is stuck with a thumbnail smaller than a fingertip.

**Fix:** Wrap attachment images in a Pressable that opens a full-screen image viewer/lightbox (with pinch-to-zoom, e.g. via a modal + react-native-image-viewing or similar) using the signed URL.

**Verifier notes:** Code claim is accurate. AttachmentItem in apps/mobile/components/card/EventRow.tsx (lines 139-167) renders images at a fixed 64x64 expo-image with no Pressable/onPress, no Modal, and no navigation to a full-screen viewer. Confirmed there is NO lightbox/image-viewer anywhere in apps/mobile (only Modal usages are GateAdvanceSheet and AreaSuggestSheet; no react-native-image-viewing dependency). Web's apps/web/components/board/EventAttachments.tsx (lines 76-92) does wrap images in <a href={signedUrl} target="_blank">, so the parity gap is real.

Severity downgraded High -> Medium for two reasons: (1) Each thumbnail already renders ai_caption directly beneath it (EventRow.tsx lines 160-161). The attachment-AI pipeline exists precisely to describe site photos (marble/crack/grout etc.), so a field user gets a text description as a content fallback and is not blocked from understanding the photo — this degrades inspection convenience, not task completion. No workflow is blocked. (2) A 64x64 tile is genuinely too small to read a label or verify a color, so the gap is real and worth fixing, but not blocking/harmful at a High level.

Fix caveat: the proposed fix says open the lightbox "using the signed URL," but this component has NO signed URL. getCardAttachments (packages/core/src/cards/queries.ts:66) returns raw card_attachments rows and AttachmentItem feeds storage_path (a Supabase bucket path) directly as the image uri — unlike web, which resolves via signAttachment first. Any lightbox implementation must first sign the storage_path (mirroring web's signAttachment), or it will fail to load exactly as the current raw-path thumbnail may already be failing on a private bucket. This signed-URL prerequisite is a separate latent issue the proposed fix glosses over.

### V-10 [Medium] (downgraded from High) — No camera capture — pickImageAsset only offers the gallery picker
**File:** `lib/attachments/pick-and-upload.ts:49`  ·  **Dimension:** -

pickImageAsset() (lines 49-68) calls only `ImagePicker.requestMediaLibraryPermissionsAsync()` and `ImagePicker.launchImageLibraryAsync(...)`. There is no `launchCameraAsync`, `requestCameraPermissionsAsync`, or expo-camera usage anywhere in the repo (verified via grep across apps/mobile). For Indonesian field staff photographing site progress/defects in real time, the only path to attach a fresh photo is: leave DATUM, open the OS camera app, take the photo, save it, return to DATUM, then pick it from the gallery. This is a major friction point for the app's core in-the-field use case.

**Fix:** Add a camera option alongside gallery in the attach picker (e.g. an action sheet offering 'Ambil Foto' via launchCameraAsync vs 'Pilih dari Galeri' via launchImageLibraryAsync), requesting camera permission as needed.

**Verifier notes:** Factually accurate: pickImageAsset() (lib/attachments/pick-and-upload.ts lines 49-68) calls only requestMediaLibraryPermissionsAsync (line 50) and launchImageLibraryAsync (line 53); repo-wide grep for launchCameraAsync/requestCameraPermissions/expo-camera/CameraView returns zero hits, so there is genuinely no in-app camera capture. Both attach entry points (components/card/AddEventForm.tsx:233 and components/chat/MessageInput.tsx:65) go through this one gallery-only helper, so the gap is systemic.

However the claimed High severity is overstated and should be Medium. No user is blocked or harmed and no data is lost — this is a missing-convenience feature, not a broken/security/correctness defect. Two real workarounds exist: (1) a photo just taken in the OS camera app appears at the top of the media library, making the "return and pick" round-trip a couple of taps; (2) more importantly, THIS branch (mobile-share-to-card) adds an OS share-intent -> add-to-card flow (lib/share/intent.ts, lib/share/add-to-card.ts) that lets a field user shoot in the OS camera and share the photo directly into a DATUM card via the share sheet — a smoother path for the exact real-time-site-photo use case the finding describes. The finding calls the gallery round-trip "the only path," which is inaccurate given this shipped share-to-card mechanism.

The proposed fix is technically sound: expo-image-picker already exposes launchCameraAsync() and requestCameraPermissionsAsync(), so an action sheet ("Ambil Foto" vs "Pilih dari Galeri") needs no new dependency (expo-camera is not required). Two caveats to flag if implemented: it must add camera usage descriptions to app config (iOS NSCameraUsageDescription / Android CAMERA permission), and it should handle camera-permission-denied with the same best-effort return-null contract the rest of the module uses.

### V-11 [Medium] (downgraded from High) — Staff-creation form nests a ScrollView inside the screen's outer ScrollView with no KeyboardAvoidingView anywhere
**File:** `components/members/StaffCreateForm.tsx:255`  ·  **Dimension:** -

StaffCreateForm wraps its 4 stacked fields (Nama Lengkap, Email, role chips, Password Sementara at lines 261-319) in its own `<ScrollView keyboardShouldPersistTaps="handled">` (line 255), but this component is rendered directly inside app/(tabs)/(matrix)/project/[slug]/members.tsx's outer `<ScrollView>` (members.tsx:243). Two same-axis (vertical) ScrollViews nested inside each other is a documented React Native anti-pattern: the inner ScrollView's keyboard-avoidance/scroll-responder logic measures relative to its own bounds, not the outer scroll offset, so when the Password field near the bottom of the form is focused there is no reliable path that brings it above the keyboard — neither ScrollView nor any KeyboardAvoidingView in this file or members.tsx compensates.

**Fix:** Remove the inner ScrollView from StaffCreateForm (render a plain View — it's already inside a scrollable parent) and wrap the members.tsx tab body in a KeyboardAvoidingView (behavior="height" on Android, "padding" on iOS) so the single remaining ScrollView owns keyboard-avoidance for the whole screen.

**Verifier notes:** Structural facts verified. StaffCreateForm.tsx:255 does wrap its 4 fields in a ScrollView (keyboardShouldPersistTaps="handled"), and this component is rendered inside members.tsx's outer ScrollView (members.tsx:243, form mounted at line 300). No KeyboardAvoidingView exists in either file. So a vertical-in-vertical ScrollView nest with zero keyboard avoidance is genuinely present.

Why NOT High (impact overstated):
1. Content is never broken or unreachable. The inner ScrollView (line 255) has NO height constraint, so inside the parent ScrollView it lays out to its full content height and is effectively inert as a scroller — it acts as a pass-through View. All fields, including Password, are fully rendered and reachable by dragging the OUTER ScrollView. The claim implies broken scrolling; in practice the outer ScrollView still scrolls the whole form. keyboardShouldPersistTaps="handled" means the user can drag-scroll while the keyboard is open, so even if the keyboard overlaps the Password field, a manual scroll reveals it. The user is not "blocked."
2. The genuine defect narrows to: on iOS the inner ScrollView captures the JS keyboard scroll-responder (scrollResponderScrollNativeHandleToKeyboard) but can't act on it (unbounded height), so auto-scroll-to-focused-input doesn't fire; and on Android edge-to-edge (Expo SDK 56 default) the keyboard overlays content without auto-avoidance regardless of the nesting. Net effect = the last input may sit under the keyboard until the user manually scrolls. That is an annoyance, not a hard block.
3. Exposure is low: this form is admin/principal-only (canManage gate, members.tsx:288) and used rarely (one-off staff onboarding, per repo memory), not a daily field-user flow. The Password field is plaintext (secureTextEntry={false}), the only element below it is the submit Button, and the success screen re-displays the temp password anyway.

Proposed fix is sound and correctly diagnosed: removing the inner ScrollView (render a plain View — it's already inside a scrollable parent) plus one screen-level KeyboardAvoidingView is the right shape. Minor caveat for the implementer: on Android edge-to-edge, KeyboardAvoidingView alone can still be unreliable; react-native-keyboard-controller / handling insets may be needed for a fully robust result — but that does not change this verdict. CONFIRMED as a real cleanup, severity Medium.

### V-12 [Medium] (downgraded from High) — Card detail screen's ScrollView omits keyboardShouldPersistTaps, so the first tap on Simpan/Kirim after typing only dismisses the keyboard
**File:** `app/(tabs)/(matrix)/project/[slug]/card/[cardSlug].tsx:171`  ·  **Dimension:** -

The card detail screen's single ScrollView (line 171-175) hosts MobileAddEventForm (several TextInputs, e.g. up to 8 fields for the "work" kind), CommentInput, and MemberPicker, but does not set `keyboardShouldPersistTaps="handled"` (default is "never"). Other forms in this codebase that do set it explicitly (app/share.tsx:286, app/(tabs)/(matrix)/new.tsx:130, StaffCreateForm.tsx:255, GateAdvanceSheet.tsx:125) confirm the team knows this is required; it was simply missed here. With the default, once any TextInput on this page is focused, tapping the "Simpan"/"Kirim" button elsewhere on the page dismisses the keyboard on the first tap instead of firing the press, requiring a second tap to actually submit.

**Fix:** Add `keyboardShouldPersistTaps="handled"` to the ScrollView at card/[cardSlug].tsx:171 (and audit the same-pattern ScrollViews in rooms.tsx:295/335, settings.tsx:145/163, and ProjectInfoForm.tsx:159 which have the identical gap).

**Verifier notes:** The finding is factually correct. The ScrollView at apps/mobile/app/(tabs)/(matrix)/project/[slug]/card/[cardSlug].tsx:171 omits keyboardShouldPersistTaps (RN default "never"), and it directly hosts the TextInputs and Simpan/Kirim submit Pressables of MobileAddEventForm, CommentInput, and MemberPicker (the child forms render plain Views, not their own scroll wrappers around the submit buttons). Under RN's "never" semantics, tapping a non-TextInput child while the keyboard is up dismisses the keyboard and swallows the tap, so the first tap on Simpan/Kirim after typing does not fire onPress — a second tap is required. The team convention is confirmed: keyboardShouldPersistTaps="handled" is set at share.tsx:286, new.tsx:130, StaffCreateForm.tsx:255, and GateAdvanceSheet.tsx:125 (all lines verified), so this is a genuine miss.

Downgraded from High to Medium because the impact is overstated: the user is NOT blocked and loses no data — the second tap submits successfully. This is recoverable two-tap friction, frequent but minor and self-correcting, on the primary write actions. No field user on a 360px Android phone is blocked or harmed beyond an extra tap. The proposed fix (add keyboardShouldPersistTaps="handled" to the ScrollView at line 171) is correct and matches the established pattern; the adjacent same-pattern ScrollViews it names are a reasonable cleanup but not required to resolve this finding.

### V-13 [Low] (downgraded from High) — In-card attach supports only one photo per activity, unlike the share-sheet flow
**File:** `components/card/AddEventForm.tsx:205`  ·  **Dimension:** -

pendingAsset is typed `PickedAsset | null` (line 205) and handlePickFile (lines 229-238) calls the single-asset pickImageAsset(), overwriting any previous selection. A field worker documenting one event (e.g. a defect, or a completed wall) with multiple angles must create multiple separate 'Catat aktivitas' entries, each with its own kind/fields filled in again, just to attach a second or third photo of the same activity — inconsistent with the newer share-to-card flow (app/share.tsx) which natively handles a PickedAsset[] batch.

**Fix:** Extend MobileAddEventForm to support multi-select (array of PickedAsset, with per-item remove), reusing the multi-upload loop already implemented in lib/share/add-to-card.ts's shareToExistingCard.

**Verifier notes:** The factual claims are all verified against source. In components/card/AddEventForm.tsx, pendingAsset is `PickedAsset | null` (line 205); handlePickFile (229-238) calls the single-asset pickImageAsset() (which itself returns only result.assets[0] and does not set allowsMultipleSelection), and setPendingAsset overwrites any previous pick. By contrast lib/share/add-to-card.ts's shareToExistingCard loops over an assets[] array. So the in-card form does cap at one photo per event and the share flow does not — the inconsistency is real.

However "High" is not warranted; this is a UX polish / feature-parity gap, not a defect that blocks or harms a field user:
1. Nothing is broken — the worker CAN attach a photo per event; there is no crash, data loss, or block.
2. A fully-functional multi-photo path to ANY existing card ALREADY EXISTS in the same app: the Android share sheet flow (app/share.tsx) lets the worker multi-select photos from the gallery and share them into a chosen/created card, uploading the whole batch via shareToExistingCard. So a worker who wants 3 angles of one defect is not forced into 3 structured entries — they can share-sheet the batch. The in-card form is simply the less-convenient of two available paths for bulk photos.
3. The workaround inside the in-card form (create multiple entries) is friction, not obstruction.

Given a real but low-impact inconsistency with an existing in-app multi-photo path, Low is honest (Medium is defensible if one weighs the multi-angle-defect workflow heavily; it is clearly not High).

On the proposed fix: broadly sound but imprecise. handleSubmit already creates the card event itself, so the form should reuse the per-asset upload LOOP (uploadCardAttachment called once per asset, as shareToExistingCard does internally) against the already-created eventId — not call shareToExistingCard wholesale, since that helper creates its own photo-kind event and would not respect the form's selected kind/payload. The finding's wording ("reusing the multi-upload loop") points at the right building block; an implementer should wire the loop, not the whole shareToExistingCard function.

### V-14 [Low] (downgraded from High) — Realtime 'recovered' signal is discarded — board/matrix/notifications silently show stale data after a channel drop
**File:** `lib/realtime/useRealtimeInvalidation.ts:16`  ·  **Dimension:** -

packages/core/src/realtime/resilient.ts implements exactly this problem: `subscribeResilient` retries a dropped Supabase channel with backoff and fires `onHealth('recovered')` when it comes back, with the explicit contract 'events during the gap were missed — callers should refetch/invalidate' (resilient.ts:6-7). subscribeToProjectChanges, subscribeToAreaGateChanges, and subscribeToOwnNotifications all accept this onHealth callback (project.ts:15, area-gates.ts:25, notifications.ts:15). But none of the three mobile hooks pass it: useProjectRealtime (lines 12-20) calls `subscribeToProjectChanges(supabase, projectId, () => {...})` with only 3 args, useAreaGatesRealtime (lines 29-43) and useNotificationsRealtime (lines 46-54) same. So on a field site with intermittent signal, a websocket drop silently resubscribes in the background, but the board/matrix/notifications screens never get told to refetch, so they can keep showing pre-drop data indefinitely unless the user happens to background+foreground the app or navigate to one of the two screens with pull-to-refresh (schedule.tsx, rooms.tsx).

**Fix:** Thread an onHealth callback through all three hooks that calls the corresponding `qc.invalidateQueries(...)` (the same set already used in each hook's onChange), so a 'recovered' event triggers the same refetch as a live change. Optionally show a brief 'menyegarkan…' toast so the recovery is visible.

**Verifier notes:** Code claims are accurate and it is a real web/mobile parity gap, but the High severity is overstated. VERIFIED FACTS: subscribeResilient fires onHealth('recovered') with the documented "callers should refetch" contract (resilient.ts:55-58); all three core fns accept onHealth as optional 4th arg (project.ts:15, area-gates.ts:25, notifications.ts:16); the three mobile hooks pass only 3 args, dropping it (useRealtimeInvalidation.ts:16,33,50); and the web app DOES wire it in all equivalents (Board.tsx:27-30, CardDetailClient.tsx:69-72, AreaGatesRefresher.tsx:29-37, NotificationBadgeClient.tsx:37-49, each `if (h==="recovered") invalidate()`). So mobile genuinely omits a signal web uses.

WHY NOT HIGH: mobile has compensating mechanisms the finding ignores. core/query/client.ts makeQueryClient sets GLOBAL refetchOnReconnect:true, refetchOnWindowFocus:true, staleTime:30_000. provider.tsx wires onlineManager↔NetInfo (lines 9-11) and focusManager↔AppState (17-22). The finding's own premise is "field site with intermittent signal" — in that exact case the websocket drop coincides with connectivity loss, so on signal return NetInfo fires offline→online → onlineManager → refetchOnReconnect refetches every mounted query (board/matrix/notifications), i.e. the same refetch the missed 'recovered' would trigger. Plus every app foreground (constant on a field phone) fires focusManager → refetchOnWindowFocus on any >30s-stale query, plus pull-to-refresh on schedule/rooms. Matrix gate-status realtime isn't even enabled yet (hooks.ts:174-180) and leans on these by design. The "keep showing pre-drop data indefinitely" claim is therefore false for the primary field scenario. Residual gap = a SILENT socket death with no network transition while the app stays foregrounded on one screen and the user never pulls to refresh; narrow, no data loss, no blocked flow, self-heals within staleTime + next foreground/reconnect. That is Low (Medium at most), not High. No field user on a 360px Android phone is blocked or harmed.

FIX ASSESSMENT: the proposed fix (thread onHealth → the same qc.invalidateQueries set, mirroring web) is technically correct and low-risk, and restores parity; worth doing as Low-priority polish. Optional 'menyegarkan…' toast is fine but cosmetic.

### V-15 [Low] (downgraded from High) — Bottom-sheet Modal with a date TextInput has no KeyboardAvoidingView; fixed footer CTA can end up under the keyboard
**File:** `components/schedule/GateAdvanceSheet.tsx:187`  ·  **Dimension:** -

GateAdvanceSheet renders a transparent, slide-in `<Modal>` (lines 85-91) containing a scrollable body with a `completedDate` TextInput (line 187-197) and a fixed footer below the ScrollView holding the primary "Tandai selesai" button (lines 211-230). Nothing in this file wraps the Modal content in a KeyboardAvoidingView, and RN Modals do not automatically participate in the same window-resize keyboard handling as the rest of the screen. Focusing the date field can push the sheet's footer (and its only primary action button) toward or under the keyboard with no compensating pan/resize.

**Fix:** Wrap the Modal's sheet View (the `<View className="rounded-t-2xl ...">` at line 100) in a KeyboardAvoidingView (behavior="padding" iOS / "height" Android) so the footer stays above the keyboard, matching the pattern already used in app/(tabs)/(matrix)/new.tsx.

**Verifier notes:** Structural claim is accurate: GateAdvanceSheet.tsx renders a transparent slide-in Modal (86-91) with the sheet View at line 100 (max-h-[88%], bottom-anchored by the flex-1 scrim), a ScrollView body containing the completedDate TextInput (187-197), and a fixed footer with the primary "Tandai selesai" button below the ScrollView (212-230). No KeyboardAvoidingView is imported or used. So the missing-KAV defect is real.

However, High is overstated; real impact is Low. (1) The date field is pre-filled with today's date (line 45, todayWIB). The dominant flow — open sheet, tap the button — never focuses the TextInput or raises the keyboard; a field user marking a gate done today is never affected. The overlap only occurs on the OPTIONAL path of editing the date to a non-today value. (2) It's fully recoverable, not blocking: keyboardShouldPersistTaps="handled" (line 125) lets the user tap the mostly-empty ScrollView to dismiss the keyboard and re-reveal the footer — no data loss, no dead-end. (3) The finding's flat claim that RN Modals never participate in keyboard resize is overstated: Expo's default android.softwareKeyboardLayoutMode is "resize", and on many Android versions the Modal lifts above the keyboard, keeping the footer visible; the reliably-harmed case is really iOS's optional, recoverable edit path.

Fix caveat: the proposed patch (wrap only the sheet View at line 100 in KeyboardAvoidingView behavior=padding) is imprecise — since the scrim's flex-1 pushes the sheet to the bottom, bottom padding on the sheet alone lands under the keyboard. The KAV should govern the scrim+sheet container (or the sheet must grow from a KAV-managed root) to actually lift the footer.

### V-16 [Low] (downgraded from High) — Whole-board invalidation on any project activity forces every card row to re-render, unmemoized
**File:** `lib/realtime/useRealtimeInvalidation.ts:16`  ·  **Dimension:** -

useProjectRealtime (line 16-19) calls `qc.invalidateQueries({ queryKey: keys.board(code) })` on ANY change reported by subscribeToProjectChanges. That subscription (packages/core/src/realtime/project.ts:29-45) listens to cards, card_events, card_comments, AND topics for the whole project_id — not scoped to the card the user is viewing. So a comment or timeline event logged on card #47 while a field worker is looking at the board causes a full board refetch (debounced 250ms), which replaces board.data with new object identities for every column and every card. Because neither Column (components/board/Column.tsx) nor MiniCard (components/board/MiniCard.tsx) is wrapped in React.memo — confirmed zero `React.memo`/`memo(` usages anywhere under apps/mobile/components or apps/mobile/app — React re-renders every MiniCard in every rendered column on every single project-wide activity event, not just the changed card. On an active project with several field staff logging events/comments through the day, this means the whole visible board tree re-renders repeatedly per minute even though at most one card actually changed.

**Fix:** Wrap MiniCard and Column in React.memo (cards/columns are plain-data props, cheap to compare). Additionally consider scoping the realtime invalidation more precisely — e.g. patch the single changed card into the cached board data via setQueryData instead of invalidating the whole board query, or at minimum debounce longer and diff card ids before invalidating.

**Verifier notes:** The finding's mechanics are factually accurate but its severity is badly overstated; it is Low, not High.

VERIFIED TRUE: useProjectRealtime (lib/realtime/useRealtimeInvalidation.ts:16-19) invalidates the whole keys.board(code) query on ANY change; subscribeToProjectChanges (packages/core/src/realtime/project.ts:29-46) listens to cards/card_events/card_comments/topics for the entire project_id; a project-wide grep confirms zero React.memo/memo( usages, so Column and MiniCard are unmemoized. On a board-data change, every rendered MiniCard re-runs its render.

WHY IT IS NOT HIGH:
1) The re-render is the cheap part. MiniCard (components/board/MiniCard.tsx) is a trivial tree — one View plus a few Text nodes, no images, no expensive computation. React Native reconciles hundreds of such nodes well under a single 16ms frame. The output JSX is structurally identical across re-renders, so RN's diff produces essentially no native layout/paint work; only the JS render+reconcile runs. Re-rendering the ~dozens of visible cards costs a few milliseconds and is imperceptible. No jank is demonstrated or measured — the "whole tree re-renders per minute" claim describes throttled JS work, not a blocked UI.

2) It is throttled/bounded. Emissions are debounced 250ms in core, so event bursts from multiple field staff collapse into at most ~4 refetches/sec, realistically a handful per minute.

3) Columns render inside a horizontal paging FlatList (app/(tabs)/(matrix)/project/[slug]/index.tsx:237-279), which windows offscreen columns, further bounding how many cards are actually mounted at once.

4) The invalidation itself is CORRECT, standard TanStack behavior — you WANT the board to reflect a newly logged comment/event/topic. It is not a bug. The real cost of invalidation is the network refetch (battery/data for a field worker), which is inherent to keeping the board live and is NOT what the proposed memo fix addresses.

FIX SANITY-CHECK: Wrapping MiniCard/Column in React.memo is harmless and marginally reduces trivial re-renders — fine as a micro-optimization, but note that the FlatList renderItem passes a fresh inline arrow and Column receives todayStr/projectCode by value, so memo helps only partially. The setQueryData-patch-instead-of-invalidate suggestion is a real optimization but adds diffing complexity and is not needed to fix any user-facing harm. No field user on a 360px Android phone is blocked or harmed by this; it is a low-priority perf hygiene item.

## Medium/Low findings (logged, not independently verified)

### M-1 [Medium] — Send and attach buttons are explicitly sized at 36x36px, below the 44px minimum
**File:** `components/chat/MessageInput.tsx:140`

Both the attach button (line 111: `className="mb-1 h-9 w-9 items-center justify-center rounded-full ..."`) and the send button (line 140: `className="mb-0.5 h-9 w-9 items-center justify-center rounded-full ..."`) hard-code `h-9 w-9` (36px). This is the send control for every assistant message in both Tanya and Catat modes — used constantly, often one-handed/thumb-reached at the bottom of the screen outdoors.

**Fix:** Bump to `h-11 w-11` (44px) for both circular buttons, or keep the visual size and add `hitSlop={{top:6,bottom:6,left:6,right:6}}` to reach 44px of effective hit area without changing the visual footprint.

### M-2 [Medium] — Column-jump chips have no min-height and land around ~24px tall
**File:** `components/board/BoardTabs.tsx:56`

The horizontal "jump to column" chips use `className="flex-row items-center gap-1 rounded-full border px-3 py-1 ..."` with `text-[11px]`/`text-[10px]` content and no min-height constraint, giving an effective height around 22-24px. This is the primary way to navigate a multi-column board on a small screen and is scrolled/tapped repeatedly.

**Fix:** Add `min-h-[36px]` (ideally `min-h-[44px]`) to the Pressable className alongside the existing padding.

### M-3 [Medium] — Target-date chip is a small Pressable nested inside the row's own expand/collapse Pressable
**File:** `components/schedule/AreaGateCard.tsx:191`

The header Pressable (line 173-222) toggles the whole area's expanded state on press. Inside its flex-row, the target-date chip is itself a second Pressable (lines 191-205, or 207-218 when no date is set) sized only `px-2 py-0.5` with `text-[11px]` — roughly 20px tall. A user aiming for this small nested control who misses by a few pixels instead toggles the entire card's expand/collapse state, which is a jarring, unrelated side effect (and the chip's own boundaries are hard to gauge visually against the larger tappable header).

**Fix:** Enlarge the date-chip Pressable to at least 36-44px effective height via padding/hitSlop, and consider visually separating it from the header row (e.g. a divider or dedicated row) so its tap boundary is unambiguous.

### M-4 [Medium] — "Buat"/"Batal" add-column buttons are ~22-24px tall
**File:** `components/board/AddColumnSlide.tsx:74`

Lines 71-95 render the confirm/cancel row with `px-3 py-1.5` and `text-[10px]`, no min-height — effective height ~22-24px. Same undersized-button pattern as AddCardForm, on the less-frequent but still core "create column" action.

**Fix:** Add `min-h-[44px]` to both Pressables to match the app's other primary-action buttons (e.g. components/ui/Button.tsx).

### M-5 [Medium] — No way to deselect an individual photo from a multi-photo share batch
**File:** `app/share.tsx:298`

The thumbnail strip (lines 291-308) renders every asset from the OS share intent as a plain, non-interactive Image (no Pressable, no remove/✕ affordance). If the user shared 6 photos from the gallery but one is a duplicate/blurry/wrong shot, there is no way to exclude just that one before tapping a card row or 'Buat & lampirkan' — all assets.length images get uploaded (lib/share/add-to-card.ts loops over every asset in args.assets with no filtering step exposed in the UI).

**Fix:** Add a small remove control on each thumbnail that filters it out of the assets array (or an equivalent per-item toggle) before submission.

### M-6 [Medium] — Failed/skipped AI captions are indistinguishable from 'no caption yet', with no retry
**File:** `components/card/EventRow.tsx:158`

AttachmentItem only branches on ai_status === 'processing' | 'pending' → 'Menganalisis…', else ai_caption present → show it, else → generic 'Lampiran' (lines 158-164). The attachment_ai_status enum (packages/db/src/types.generated.ts) also includes 'failed' and 'skipped', but mobile renders both exactly like a brand-new attachment that simply hasn't been captioned — there is no failure indicator and no way to trigger a retry, even though core already exports reanalyzeAttachment (packages/core/src/cards/attachments.ts lines 91-101) and web uses it (apps/web/components/board/EventAttachments.tsx). A user has no signal that AI captioning permanently failed on a photo vs. is still pending.

**Fix:** Show a distinct state for ai_status === 'failed' (e.g. a warning icon + 'Gagal menganalisis' + a retry button calling reanalyzeAttachment) instead of falling through to the generic 'Lampiran' label.

### M-7 [Medium] — Cancelling the share sheet can be a dead end on a cold-started share intent
**File:** `apps/mobile/app/share.tsx:225`

`cancel()` (line 225-228) does only `resetShareIntent(); router.back();` with no `router.canGoBack()` guard or fallback destination (a repo-wide grep for `canGoBack` returns zero hits anywhere in the app). When the user shares images into DATUM while the app is fully closed, `app/_layout.tsx`'s `ShareIntentRedirect` (lines 30-41) fires `router.replace("/share")` as soon as the Gate lands the user in `(tabs)/(matrix)` — a `replace`, not a `push`, so no prior screen is pushed onto the stack for `/share` to pop back to. Tapping the header "✕ Batal" or the empty-state "Tutup" button in that cold-start scenario calls `router.back()` with nothing beneath it to return to, leaving the user stuck on the share screen with no visible way to reach the rest of the app.

**Fix:** In `cancel()`, check `router.canGoBack()` and fall back to `router.replace("/(tabs)/(matrix)")` when there is no prior route, so cancelling always lands the user somewhere navigable.

### M-8 [Medium] — Online/offline detection only checks isConnected, not isInternetReachable — false 'online' state on weak/no-internet networks
**File:** `lib/query/provider.tsx:9`

`onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(!!state.isConnected)))` only inspects `state.isConnected`, which on Android just means 'attached to a network interface' (WiFi/cellular radio), not that the connection actually reaches the internet. On a construction site with a weak cell signal or a captive/local WiFi with no uplink, NetInfo can report isConnected:true while every Supabase request actually fails or times out. In that state the OfflineBanner (components/ui/OfflineBanner.tsx, driven by this same onlineManager) stays hidden — the user gets no 'mode luring' reassurance — and instead sees a bare 'Gagal memuat…' error with no context that it's a connectivity problem, undermining the offline messaging the rest of the app relies on.

**Fix:** Combine both signals, e.g. `setOnline(!!state.isConnected && state.isInternetReachable !== false)`, matching the pattern in TanStack Query's own React Native NetInfo integration example.

### M-9 [Medium] — Card-detail sub-section fetch errors (areas/comments/members) have no retry affordance
**File:** `app/(tabs)/(matrix)/project/[slug]/card/[cardSlug].tsx:195`

When areasQuery, commentsQuery, or membersQuery fail (lines 195-198, 246-249, 279-282), the UI renders only a static italic line — 'Gagal memuat area.' / 'Gagal memuat komentar.' / 'Gagal memuat anggota.' — with no button and no call to `.refetch()`. Unlike the top-level card query (which does use ErrorState+onRetry), a transient failure on any of these three sub-resources (very plausible on a flaky connection, since they're separate round trips from the main card fetch) leaves that section permanently blank-with-error until the query happens to become active again via refetchOnWindowFocus — there's no pull-to-refresh on this screen and no manual retry control.

**Fix:** Give each failed section a small 'Coba lagi' pressable that calls the corresponding query's `.refetch()`, consistent with the top-level ErrorState pattern already used elsewhere in this file.

### M-10 [Medium] — ProjectInfoForm's shared Field component never sets returnKeyType/onSubmitEditing across its 5 stacked inputs
**File:** `components/settings/ProjectInfoForm.tsx:30`

The `Field` helper (lines 30-57) used for Nama Proyek, Klien, Lokasi, Tanggal Kickoff, and Target Serah Terima never passes `returnKeyType` or `onSubmitEditing`, so pressing the keyboard's return key does nothing on any of the five fields — there is no way to advance to the next field or submit from the keyboard. The two date fields (kickoff/target, lines 192-205) also use the default `keyboardType` instead of a numeric one, despite requiring YYYY-MM-DD digits.

**Fix:** Give Field a `returnKeyType="next"` (or "done" on the last field) plus a `ref`+`onSubmitEditing` chain to the next input (or to handleSave on the last), and set `keyboardType="numbers-and-punctuation"` on the two date fields (mirroring app/(tabs)/(matrix)/new.tsx:286 which already does this for targetHandover).

### M-11 [Medium] — Login screen has no return-key chaining between email and password, and no KeyboardAvoidingView/ScrollView fallback
**File:** `app/(auth)/login.tsx:22`

Neither the email TextInput (lines 22-29) nor the password TextInput (lines 31-37) sets `returnKeyType` or `onSubmitEditing`, so there is no keyboard-driven path from email → password → submit; users must manually dismiss the keyboard and tap the Pressable button. The screen is also a bare `flex-1, justifyContent:"center"` View with no ScrollView and no KeyboardAvoidingView (lines 18-51), so there is no scroll fallback if the keyboard (plus any autofill/password-manager suggestion strip on Android) leaves the submit button too low to reach.

**Fix:** Add `returnKeyType="next"` + `onSubmitEditing` on the email field to focus the password input (via ref), `returnKeyType="go"` + `onSubmitEditing={submit}` on the password field, and wrap the form in a KeyboardAvoidingView (or a ScrollView with keyboardShouldPersistTaps="handled") as a safety net for short screens.

### M-12 [Medium] — Board column card list uses ScrollView + .map instead of FlatList — no virtualization for an unbounded, ever-growing list
**File:** `components/board/Column.tsx:39`

Column.tsx renders `column.cards.map((card) => <MiniCard .../>)` (line 39-46) inside a plain ScrollView (line 23). Cards are Trello-style work items that accumulate over a project's entire lifecycle and are never pruned, so a long-running 'Aktif' column can realistically reach dozens-to-hundreds of cards. Every MiniCard for every card in a mounted column is rendered and kept mounted at once, with no windowing — unlike the outer horizontal FlatList (app/(tabs)/(matrix)/project/[slug]/index.tsx:237) which does virtualize the columns themselves.

**Fix:** Replace the ScrollView+map in Column.tsx with a vertical FlatList (data=column.cards, keyExtractor=card.id, renderItem=MiniCard), keeping AddCardForm as ListFooterComponent. This bounds render cost to the visible viewport per column instead of the full card count.

### M-13 [Medium] — Schedule accordion renders all areas via ScrollView + .map with an unmemoized O(n·m) lookup per area on every render
**File:** `app/(tabs)/(matrix)/project/[slug]/schedule.tsx:212`

`matrixQuery.data.areas.map((area) => <AreaGateCard .../>)` (line 212-222) sits in a plain ScrollView and mounts an AreaGateCard for every area in the project up front (no virtualization) — for developments with many rooms/areas this list is unbounded. Compounding this, `areaTargetDate(areaId)` (line 147-153) does two separate `scheduledCells.find()` linear scans per area, called inline during render for every area on every re-render (schedule.tsx re-renders on every realtime gate-status invalidation via useAreaGatesRealtime, and scheduledCells itself is a fresh array reference each fetch). Neither the function nor its result is memoized, so the full areas × cells scan re-runs on every parent re-render even when only one gate's status changed.

**Fix:** Memoize a `Map<areaId, targetDate>` once per scheduledCells fetch (useMemo keyed on scheduledCells) instead of calling .find() twice per area per render; consider FlatList for the area accordion if projects can have large area counts.

### M-14 [Low] — Edit/Hapus secondary-action buttons are standardized at 32x32px across the app, below the 44px guideline
**File:** `components/card/CommentInput.tsx:140`

`className="min-h-[32px] min-w-[32px] items-center justify-center"` (lines 140 and 148 here) is a deliberate, repeated pattern also used in MemberPicker.tsx (line 65, 161) and CardAreas.tsx (line 119) for Edit/Hapus/Tutup controls. It's consistent (not a one-off bug) and these are secondary rather than primary actions, but at 32px they still sit noticeably under the 44px comfortable-tap guideline for outdoor/gloved field use.

**Fix:** If screen space allows, raise the shared min-h/min-w to 40-44px; otherwise add `hitSlop={{top:6,bottom:6,left:6,right:6}}` to these Pressables to close the gap to 44px without changing the visual chip size.

### M-15 [Low] — No per-photo progress during multi-photo sequential upload, just a static spinner
**File:** `app/share.tsx:506`

shareToExistingCard uploads assets sequentially, one at a time (lib/share/add-to-card.ts lines 56-67), which the file's own header comment justifies as deliberate ('site photos are large and RN blob memory is finite'). But the UI only shows a generic full-screen overlay with 'Mengunggah…' and a spinner (share.tsx lines 506-514) for the whole batch, with no 'x of y foto' counter. On a flaky field connection uploading, say, 8 large site photos, the user has no way to tell whether the app is still working or has stalled, and no way to cancel a batch that's stuck partway through.

**Fix:** Track and display upload progress as 'Mengunggah foto {n} dari {total}…' during the sequential loop, and consider a cancel action for a stuck/long-running batch.
