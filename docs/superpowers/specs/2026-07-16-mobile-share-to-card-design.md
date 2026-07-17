# Mobile Share-to-Card + Native App Audit + Android Test Build — Design

**Date:** 2026-07-16
**Status:** Approved by Wilson (chat, 2026-07-16)
**Branch:** worktree `mobile-share-to-card` → PR to `main`

## Goal

Make DATUM's Android app as comfortable as Trello for field use — above all, sharing
site photos into project cards straight from WhatsApp/Gallery — and hand Wilson an
installable APK to test on his phone.

Three deliverables:

1. **Android share-sheet "Add to card"** — DATUM registers as an Android share target;
   shared image(s) flow into an existing or new card.
2. **Full native-app UX audit** — every screen of `apps/mobile` audited for mobile
   comfort; all Critical/High findings fixed before the build; the rest logged.
3. **EAS Android build config** — preview APK profile Wilson can build and install
   with three commands.

## Non-goals

- iOS share extension (Android first; iOS later).
- Sharing non-image files (PDF/video) — the attachment pipeline caps at images + PDFs
  ≤ 20 MB; share-sheet accepts `image/*` only for now.
- Google Play distribution (internal-testing track is a follow-up once the APK proves out).
- Web share-target/PWA work.

## 1. Share-sheet "Add to card"

### Library

`expo-share-intent` (config plugin + `useShareIntent` hook), pinned to the release
compatible with Expo SDK 56. It writes the Android `ACTION_SEND` / `ACTION_SEND_MULTIPLE`
intent filters for `image/*` and exposes shared files as local URIs. Requires a dev/EAS
build (not Expo Go) — acceptable, since the deliverable is an EAS build.

Alternatives considered: hand-rolled config plugin + native module (same result, more
maintenance); PWA share target (cannot register like a native app — rejected with the
"native app" surface decision).

### Flow (mirrors Trello)

1. User shares photo(s) from any app → picks DATUM → app cold/warm-starts and
   expo-router lands on a dedicated **`/share` screen** (outside the tab navigator).
2. Screen layout, top to bottom:
   - Thumbnails of the shared image(s) (multi-image supported via `ACTION_SEND_MULTIPLE`).
   - **Proyek** picker — defaults to last-used project (AsyncStorage), like Trello's "To".
   - **Topik** picker (DATUM's equivalent of Trello's List) — defaults to last-used topic
     within that project.
   - Card list for that topic (title + attachment/comment counts) — **tap a card to attach
     to it** — plus a **"Kartu baru"** input to create a card with the images attached.
   - Optional **note field** — saved as the text of the event (comment) that carries
     the attachments.
   - Confirm button (top-right ✓, like Trello) / cancel (×).
3. On confirm:
   - New card: `createCard(projectId, topicId, title)` from `@datum/core`.
   - One card event is created (existing event-kind used by mobile photo attach —
     reuse whatever `AddEventForm` creates, payload carries the optional note).
   - Each image uploads via the existing `uploadCardAttachment()` pipeline
     (validation → Supabase Storage `card-attachments` → `attachToEvent` row →
     AI captioning cron picks it up automatically). Per-image progress; per-image
     soft-skip messages (oversize/unsupported) surface without aborting the batch.
   - Success → toast + deep-link to the card detail screen; failure → readable error,
     images stay selected for retry.
4. **Auth gate:** if there is no session, the share payload is held in memory,
   the login screen opens, and the flow resumes at `/share` after sign-in.

### Data / state notes

- Last-used project + topic stored in AsyncStorage (`share.lastProjectId`, `share.lastTopicId`).
- Project/topic/card lists come from the existing TanStack Query hooks (offline cache
  already persisted) — the share screen works on cached data if the network is flaky
  and the upload retries/fails visibly.
- No schema changes. No new storage buckets. RLS continues to scope everything.

### Error handling

- Permission-free: shared URIs arrive via the intent — no media-library permission needed.
- Oversize/unsupported images: per-image skip message (existing `attachmentSkipReason`).
- Upload/DB failure mid-batch: report which images failed; card/event creation is not
  rolled back (matches existing best-effort attach design); user can retry from the card.
- Share of non-image types: intent filter only registers `image/*`, so DATUM simply
  doesn't appear in the share sheet for other content.

## 2. Native app UX audit

Fable 5 orchestrates and evaluates; audit sweeps fan out to Sonnet agents, harder
verification/fix design to Opus. Dimensions:

1. Touch targets, spacing, layout overflow on small screens (360–412 px widths).
2. The complete photo journey: share-in (new), in-card attach, image viewing/zoom,
   upload feedback, AI-caption visibility.
3. Navigation: tab structure, back behavior, deep links (`datum://` scheme, push-tap routing).
4. Offline/error/loading states: query cache behavior, spinners, empty states, retry affordances.
5. Keyboard behavior: form fields hidden by keyboard, `KeyboardAvoidingView` coverage, input types.
6. List performance: FlatList usage vs `.map()`, large-board rendering.

Output: `AUDIT_MOBILE_APP.md` in repo root (same convention as the existing web audits).
Every Critical/High finding is verified by a second agent before it's fixed (adversarial
check — no plausible-but-wrong fixes). Critical/High fixed on this branch; Medium/Low
logged with file/line for a later pass.

## 3. EAS Android build

- `eas.json`: `preview` profile → APK (`buildType: "apk"`, internal distribution),
  `production` profile → AAB, `development` profile → dev client.
- `app.json` additions: `expo-share-intent` plugin (image-only, single + multiple),
  Android `versionCode`, adaptive icon check, notification icon if needed.
- Env: Supabase URL + anon key wiring for EAS builds (verify how `lib/env.ts` reads
  them; set as EAS build env vars or `app.json` extra — anon key is publishable).
- **Wilson's one-time ops (documented in PR):**
  1. `npm i -g eas-cli && eas login` (free Expo account)
  2. `eas init` in `apps/mobile` (writes the EAS `projectId` into app.json — commit it)
  3. `eas build -p android --profile preview` → install link/QR on the phone.
- **Known follow-up:** Android remote push needs a Firebase `google-services.json`
  (FCM). Documented as a separate ops step; nothing else blocks on it.

## Testing

- TDD throughout (superpowers workflow). Jest + @testing-library/react-native, same
  patterns as existing screen tests.
- Unit: share-payload → upload orchestration (multi-image, partial failure, auth-gate
  resume, last-used persistence).
- Screen: `/share` renders pickers with defaults, card list, new-card mode, confirm
  paths (existing + new card), error surfaces.
- Baseline: 224 tests passing (first cold run showed 6 timeout flakes; warm runs clean).
- On-device: real share-sheet + upload can only be proven on Wilson's phone — the PR
  lists an explicit smoke-test script for him.

## Risks

- **expo-share-intent ↔ SDK 56 compatibility** — pin the matching major; if the plugin
  breaks on SDK 56, fall back to writing the intent-filter config plugin ourselves
  (contained: same hook shape).
- **Cold-start share timing** — shared intent must survive the auth/router bootstrap;
  handled by the hold-and-resume design and covered by tests around the router guard.
- **First EAS build friction** (keystore generation, projectId) — EAS handles keystores
  automatically; ops steps documented exactly.
