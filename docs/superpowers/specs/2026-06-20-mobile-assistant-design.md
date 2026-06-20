# Mobile slice — AI Assistant (chat) — DESIGN SPEC

Slug: `assistant`
Date: 2026-06-20
Status: Design (no code in this doc)

This is a design document. It cites real web files; it does NOT introduce
implementation code. The goal is full parity of the web "Asisten" experience on
the Expo Router mobile app, mounted in the existing **Assistant** tab
(`apps/mobile/app/(tabs)/assistant.tsx`, currently a placeholder).

---

## 1. Goal & scope

Deliver the DATUM assistant on mobile with parity to the web `ChatDock`:

- **Tanya (Ask)** — Indonesian Q&A grounded in project cards/events, streamed
  token-by-token, with citation tokens rendered as inline card snippets.
- **Catat (Capture)** — free-text (optionally with a photo/PDF) → AI proposes a
  single `card_event` → user reviews a **ProposalCard** → commits (writes the
  event, optionally creates a new card from a Trello template placeholder,
  uploads the attachment, optionally links to an area).
- **Streaming** UX (growing bubble, typing dots, caret), **error/retry**, and an
  **offline send queue** (notes never lost on a dead spot), mirroring web.
- Session persistence + audit (assistant_sessions / assistant_messages /
  assistant_query_audit) — already handled server-side by the web API routes.

**Key architecture decision for this slice (recommended):**
**Mobile calls the EXISTING web API routes** (`/api/assistant/message`,
`/api/assistant/capture`, `/api/assistant/snippet`) with the Supabase access
token in an `Authorization: Bearer` header. It does **NOT** reimplement
Anthropic streaming on-device.

Rationale (load-bearing):
- `ANTHROPIC_API_KEY` MUST stay server-side. `apps/web/lib/assistant/anthropic.ts`
  reads `process.env.ANTHROPIC_API_KEY` (line 29) and constructs the SDK client on
  the server. Shipping that key into an Expo bundle (`EXPO_PUBLIC_*` is public)
  would leak it. So the Anthropic call stays on the web server.
- The message route already does the full pipeline server-side: auth → staff gate
  → retrieval → stream → audit (`apps/web/app/api/assistant/message/route.ts`).
  Reusing it gives mobile audit logging + prompt caching + the advisor context
  injection for free, with zero duplication.
- The NDJSON wire protocol is plain `fetch` + a `ReadableStream` reader on web
  (`ChatDock.runTanya`). React Native's `fetch` does not expose `response.body`
  as a web `ReadableStream`, so the **streaming reader must be replaced** with an
  RN-compatible transport (see §5). This is the one real porting cost.

What we still extract into `@datum/core` (per LOCKED DECISION 1): the **pure,
isomorphic pieces** the mobile client needs locally — citation parsing, the
NDJSON event types, the offline-queue logic, the request Zod schemas, and the
snippet-shaping query — so both web and mobile agree on them and web repoints to
core (strangler step).

---

## 2. Web behavior mirrored — exact files + functions

Read and mirrored:

### API routes (server, stay as-is; mobile calls them)
- `apps/web/app/api/assistant/message/route.ts` — `POST`. Auth via
  `supabase.auth.getUser()`; staff gate (`staff.id === user.id`); validates body
  with `ChatRequest.parse`; `retrieveProjectContext` + `buildContextBlock`;
  `streamAssistant`; streams **NDJSON** with three event shapes documented at the
  top of the file:
  - `{"type":"delta","text":"..."}`
  - `{"type":"done","sessionId":...,"citations":[...],"usage":{...}}`
  - `{"type":"error","message":"..."}`
  Pre-stream failures are plain JSON with real HTTP status codes (401/403/400/500/
  502/503) so the client can decide whether to retry. Audit via `ensureSession` +
  `recordExchange` is best-effort after the stream. Response headers:
  `Content-Type: application/x-ndjson`, `Cache-Control: no-cache, no-transform`,
  `X-Accel-Buffering: no`.
- `apps/web/app/api/assistant/capture/route.ts` — `POST`. Body Zod schema
  `{ projectId, text(1..4000), file?{name,mime,size<=20MB} }`. Returns
  `{ ok:false, error }` for soft failures and `{ ok:true, proposal:{...} }` on
  success. The proposal shape (lines 196–214): `projectId, cardId, cardTitle,
  cardSlug, topicName, eventKind, payload, rationale, confidence, fileMeta,
  areaHint{areaId,areaCode,areaName}|null, createNew, newCardTitle, topicId`.
  Validates `card_id ∈ retrieved set`, `event_kind ∈ EVENT_KINDS`, payload against
  `EventPayloadSchemas[kind]`, `area_hint ∈ project areas`. Template-placeholder
  detection via `isTemplateCardTitle` → `createNew=true` + WIB-dated `newCardTitle`
  from `deriveCardLabel` (`apps/web/lib/cards/template-card.ts`).
- `apps/web/app/api/assistant/snippet/route.ts` — `GET ?cardId&eventIds`. Returns
  `{ card{id,title,slug,current_summary}, topicName, events[{id,event_kind,
  occurred_at,payload}] }` (latest 6, or the cited ids).

### Assistant lib (server/iso)
- `apps/web/lib/assistant/anthropic.ts` — `getModel` (default
  `claude-haiku-4-5-20251001`), `SYSTEM` prompt (Indonesian, citation-token
  rules), `getAnthropicClient`, `cachedSystemBlock` (prompt caching),
  `streamAssistant`, `askAssistant`, `textOf`, **`extractCitations`** (regex over
  `[card:UUID]` / `[event:UUID]`, best-effort grouping). `AnthropicNotConfiguredError`.
- `apps/web/lib/assistant/retrieval.ts` — `retrieveProjectContext` (newest-active
  + keyword/event-payload hits, captions, advisor injection via WeakMap),
  `buildContextBlock`, `CardWithEvents` type, `MAX_CARDS_IN_CONTEXT=40`,
  `MAX_EVENTS_PER_CARD=8`.
- `apps/web/lib/assistant/audit.ts` — `ensureSession`, `recordExchange`.
- `apps/web/lib/assistant/types.ts` — `ChatRequest` Zod + `ChatResponse` type.
- `apps/web/lib/assistant/offline-queue.ts` — `QueuedItem`, `QueuedMode`,
  `QUEUE_CAP=20`, `TANYA_MAX_AGE_MS=30min`, `readQueue/enqueue/peek/remove/drain`.
  Pure functions; storage abstracted behind a `getStorage()` accessor (currently
  `localStorage`).

### Chat components (client; reimplemented natively)
- `apps/web/components/chat/ChatDock.tsx` — the orchestrator: mode toggle, send/
  retry pipeline, `fetchWithRetry` (20s first-byte timeout, retries `[1s,3s]` on
  network/5xx, never on 4xx), `NetworkError` tagging → offline queue, NDJSON
  reader (`runTanya`), capture flow (`runCatat`), session persistence to
  `localStorage` (`datum.chat.<projectId>`, `STORED_MESSAGE_CAP=30`,
  `toStorable`/`isStoredMessage`), drain pipeline with `drainingRef`/`busyRef`/
  `inFlightIds` guards + `window "online"` listener, `resetChat`. Labels:
  `WAITING_LABEL`, `RETRYING_LABEL`, `DRAINING_LABEL`, `QUEUED_NOTICE`.
- `apps/web/components/chat/MessageList.tsx` — `Message` union type, bubble
  rendering, `stripCitationTokens`, `PendingDots`, streaming caret, error bubble +
  "Coba lagi", queued amber bubble, citations → `InlineCardSnippet`, auto-scroll.
- `apps/web/components/chat/MessageInput.tsx` — text input + (Catat-only) file
  picker (`accept="image/*,application/pdf"`), submit guard.
- `apps/web/components/chat/ProposalCard.tsx` — review/commit UI: confidence chip,
  high-risk badge (`HIGH_RISK_KINDS`), low-confidence two-tap gate
  (`confirmArmed`), editable new-card title, area-link checkbox (default on), file
  chip, payload `<pre>`, rationale, and the commit sequence: `createCard?` →
  `createCardEvent` → `uploadCardAttachment` + `attachToEvent` → `linkCardToArea?`
  (all from `apps/web/lib/cards/*`), then "Buka kartu" link on success.
- `apps/web/components/chat/InlineCardSnippet.tsx` — fetches `/api/assistant/snippet`,
  shows `extractUrls`, picks first meaningful payload text field.

### Mount point (parity reference)
- `apps/web/app/(app)/project/[slug]/page.tsx:102` —
  `<ChatDock projectId={board.project.id} projectCode={board.project.project_code} />`.
  Web scopes the assistant to one project (the open board). Mobile must do the
  same: the assistant is always **project-scoped** (it needs a `projectId`).

---

## 3. `@datum/core` surface to extract (strangler step)

`@datum/core` does not exist yet (`packages/` currently holds only `db` and
`types`). This slice **bootstraps it** with the assistant's isomorphic pieces and
adds the alias to `tsconfig.base.json` (`@datum/core` → `packages/core/src`) plus
a `package.json` (`@datum/core`, deps on `@datum/db`, `@datum/types`, `zod`) and
adds `@datum/core: workspace:*` to both `apps/web` and `apps/mobile`.

> HARD RULE compliance: every extracted function takes a
> `SupabaseClient<Database>` argument; **no `server-only`, no `next/*`, no
> `@anthropic-ai/sdk`, no React, no `localStorage`/`window`** in core. The
> Anthropic streaming call stays in `apps/web/lib/assistant/anthropic.ts` (web
> server only) because it needs the secret key — it is deliberately NOT moved.

### `core/assistant/protocol.ts`
Pure types + parsers for the NDJSON wire format and citations. No I/O.

```ts
export type AssistantStreamEvent =
  | { type: "delta";  text: string }
  | { type: "done";   sessionId: string | null;
      citations: Citation[];
      usage: { input_tokens: number; output_tokens: number } }
  | { type: "error";  message: string };

export type Citation = { cardId: string; eventIds: string[] };

export function parseStreamLine(line: string): AssistantStreamEvent | null;
export function extractCitations(answer: string): Citation[];   // moved verbatim
export function stripCitationTokens(text: string): string;       // moved from MessageList
```
From: `extractCitations` ← `apps/web/lib/assistant/anthropic.ts`;
`stripCitationTokens` ← `apps/web/components/chat/MessageList.tsx`; event shapes ←
the NDJSON contract documented in `message/route.ts`.
Web repoint: `anthropic.ts` re-exports `extractCitations` from core (the route
keeps importing the same name); `MessageList` imports `stripCitationTokens` from
core. The mobile NDJSON reader uses `parseStreamLine` instead of inlining
`JSON.parse`.

### `core/assistant/schemas.ts`
```ts
export const ChatRequest:   z.ZodType<{ projectId; question; sessionId? }>;
export const CaptureRequest: z.ZodType<{ projectId; text; file? }>;
export type ChatRequest;
export type CaptureRequest;
export type Proposal = { /* the exact capture-route proposal shape */ };
```
From: `ChatRequest` ← `apps/web/lib/assistant/types.ts`; `CaptureRequest` ← the
inline `Body` schema in `capture/route.ts` (lines 16–24); `Proposal` ← the
`ProposalCard.Proposal` type (`apps/web/components/chat/ProposalCard.tsx:9-31`)
minus web-only `pendingFile: File`.
Web repoint: `lib/assistant/types.ts` re-exports `ChatRequest` from core; the
capture route imports `CaptureRequest` from core; `ProposalCard` imports
`Proposal` from core. Mobile uses the same `Proposal` type with `pendingAsset`
(an Expo asset) instead of `File`.

### `core/assistant/offline-queue.ts`
The whole offline-queue module, made storage-agnostic.
```ts
export interface QueueStorage {
  getItem(k: string): string | null | Promise<string | null>;
  setItem(k: string, v: string): void | Promise<void>;
  removeItem(k: string): void | Promise<void>;
}
export type QueuedItem; export type QueuedMode;
export const QUEUE_CAP; export const TANYA_MAX_AGE_MS;
export function readQueue(s: QueueStorage, projectId): Promise<QueuedItem[]>;
export function enqueue(s, projectId, item): Promise<QueuedItem>;
export function remove(s, projectId, id): Promise<void>;
export function drain(s, projectId, now?): Promise<QueuedItem[]>;
```
From: `apps/web/lib/assistant/offline-queue.ts` (already pure; just inject the
storage instead of reading `globalThis.localStorage`).
Web repoint: web passes a thin `localStorage`-backed `QueueStorage`; mobile
passes an `AsyncStorage`-backed one (async-friendly signatures above accommodate
both). `id` generation uses an injected `() => string` (web `crypto.randomUUID`,
RN `expo-crypto`/`Crypto.randomUUID`).

### `core/assistant/snippet.ts`
```ts
export async function getCardSnippet(
  supabase: SupabaseClient<Database>,
  args: { cardId: string; eventIds?: string[] },
): Promise<{ card: {...}; topicName: string; events: {...}[] } | null>;
```
From: the query in `apps/web/app/api/assistant/snippet/route.ts` (lines 11–29).
Web repoint: the snippet route calls `getCardSnippet(supabase, …)` and wraps the
result in `NextResponse.json`. **Mobile calls `getCardSnippet` directly with its
anon Supabase client** (RLS-scoped) — no need to round-trip the web API for a
read-only snippet (parity with LOCKED DECISION 1: reads go straight to core).

### `core/assistant/keys.ts` (shared query keys)
Per the brief ("consider hosting shared query keys in @datum/core"):
```ts
export const assistantKeys = {
  session: (projectId: string) => ["assistant", "session", projectId] as const,
  snippet: (cardId: string, eventIds: string[]) =>
    ["assistant", "snippet", cardId, eventIds.join(",")] as const,
};
```
Web's existing `apps/web/lib/query/keys.ts` has no assistant keys today; web's
`InlineCardSnippet` uses a raw `useEffect` fetch. Both web and mobile adopt these
keys when they move snippet fetching to react-query.

### NOT extracted (stays web-server-only, by design)
- `apps/web/lib/assistant/anthropic.ts` streaming/SDK calls + `SYSTEM`/`CAPTURE_SYSTEM`
  prompts + prompt caching (needs `ANTHROPIC_API_KEY`).
- `apps/web/lib/assistant/retrieval.ts` + `audit.ts` — these run inside the
  message/capture routes mobile calls; not needed on-device. (They are good
  *future* core candidates for other slices, but this slice keeps them server-side
  to avoid pulling the advisor/captions read-graph into mobile.)
- `apps/web/lib/cards/{mutations,upload,area-link-mutations}.ts` — the
  ProposalCard commit path. These are **owned by the Card/Board slices**; this
  slice **depends on** their core extractions (see §11). It does NOT extract them.

---

## 4. Mobile screens — Expo Router routes + NativeWind components + states

The assistant is project-scoped (web needs a `projectId`). On mobile the
**Assistant tab** is the chat surface; it must know which project is active.

### Routes (Expo Router)
- `app/(tabs)/assistant.tsx` — **Assistant home**. If a "current project" is set
  (shared app state, see §11 dependency on Matrix slice), it renders
  `<AssistantChat projectId projectCode />` full-screen. If none is set, it shows
  a **project picker** (recent projects) → selecting one sets current project and
  reveals the chat. (Web is always inside a board; mobile reaches the tab without
  a board, so the picker is the mobile-only addition.)
- Optional deep route `app/(tabs)/assistant/[projectCode].tsx` for nested-stack
  parity (LOCKED DECISION 4) so a card screen can deep-link "ask about this
  project". Out of scope to wire every entry point in this slice; the route shape
  is reserved.

### Components (NativeWind; SANO tokens per LOCKED DECISION 2)
- `AssistantChat` — RN port of `ChatDock`. Owns mode, messages, sessionId, busy,
  pendingLabel, queueCount, lastFailed. Layout: dark header band (Asisten label +
  `Tanya/Catat` segmented control + queue badge + "Mulai baru"), `MessageList`
  (FlatList), `MessageInput` footer. Uses `KeyboardAvoidingView` +
  `react-native-safe-area-context` insets (the web sheet uses
  `env(safe-area-inset-*)`).
- `MessageList` — **`FlatList`** (inverted or auto-scroll-to-end on append),
  renders the same `Message` union. Bubbles: user (right, `flag-ok-bg`), assistant
  (left, surface + border), streaming caret (Reanimated pulse, respect Reduce
  Motion), `PendingDots` (Reanimated bounce), amber queued bubble, critical error
  bubble + "Coba lagi" button (only on the last error). Citations → `CardSnippet`.
- `MessageInput` — `TextInput` (multiline, max length mirroring 2000 Tanya /
  4000 Catat), Catat-only attach button using **`expo-image-picker`** (camera +
  library, `image/*`) and **`expo-document-picker`** (PDF). Send button disabled
  when empty. (Web uses an `<input type=file>`; mobile uses native pickers —
  important for parity with a construction-site phone workflow: take a photo on
  the spot.)
- `ProposalCard` — RN port. Same states (`pending|saving|saved|discarded|error`),
  confidence chip + color thresholds (≥80 ok / ≥50 sand / <50 critical),
  high-risk badge, low-confidence two-tap `confirmArmed`, editable new-card title
  `TextInput`, area-link `Switch` (default on), file chip, payload preview
  (scroll `Text` in mono), rationale, "Buka kartu" → router push to the card
  screen. Commit calls the **core card mutations** (§11), then `uploadCardAttachment`
  with the picked asset's `uri`/`blob`.
- `CardSnippet` — RN port of `InlineCardSnippet`, fed by `getCardSnippet` via
  react-query (§3 `core/assistant/snippet.ts`), with tappable URL chips
  (`expo-web-browser` / `Linking`).

### Every state
| State | Tanya | Catat |
|---|---|---|
| **loading / streaming** | growing bubble + caret; pre-first-byte shows `PendingDots` + "Sedang memproses…" | spinner bubble "Sedang memproses…", then ProposalCard |
| **empty** | helper text: "Mode Tanya: ajukan pertanyaan…" (from `MessageList` line 64) | same helper, Catat half |
| **error (4xx/5xx server)** | critical bubble with server `message` (e.g. 503 "Asisten belum dikonfigurasi", 403 no-staff Indonesian copy) + "Coba lagi" | `{ok:false,error}` → "Tidak bisa mencatat: …" bubble (no proposal) |
| **offline / network fail** | amber `QUEUED_NOTICE` bubble; item parked in AsyncStorage queue; auto-resend on reconnect | same; Catat notes never dropped by age |
| **no project selected** | project picker screen | project picker screen |
| **slow connection** | `RETRYING_LABEL` "Koneksi lambat — mencoba lagi…" during the `[1s,3s]` retries | same |
| **draining queue** | `DRAINING_LABEL` "Mengirim catatan tertunda…" + `N tertunda` badge | same |

i18n: copy lives in `apps/mobile/messages/{en,id}.json` (Indonesian default).
The Indonesian strings above are copied verbatim from the web components so the
two apps read identically. (Web hardcodes these in the components; mobile should
key them — a small parity improvement, not a behavior change.)

---

## 5. Data fetching — react-query keys, realtime, optimistic updates

### Streaming transport (the one real port)
RN `fetch` does not give a web `ReadableStream` on `response.body`, so
`ChatDock.runTanya`'s `res.body.getReader()` loop cannot be copied. Recommended
transport, in order of preference:
1. **`expo/fetch` (`expo` package's WinterCG fetch) streaming** — Expo 56 ships a
   spec-compliant `fetch` whose `response.body` is an async-iterable byte stream.
   Iterate it, `TextDecoder`-decode, split on `\n`, and feed each line to
   `parseStreamLine` (core). This is the closest 1:1 port of `runTanya` and the
   recommended path. (Confirm the exact import against
   https://docs.expo.dev/versions/v56.0.0/ per `apps/mobile/AGENTS.md`.)
2. **Fallback: `react-native-sse` / XHR `onprogress` chunking** if streaming fetch
   is unavailable — read the growing `responseText`, diff new bytes, split on
   `\n`. NDJSON works over progressive XHR because it is line-delimited.
3. **Last resort: non-stream mode** — the web route already supports a plain-JSON
   fallback (`runTanya` lines 189–196 handle `content-type: application/json`).
   Mobile could request a one-shot answer, but this loses the live-typing feel.
   Prefer (1).

Auth: every request sends `Authorization: Bearer ${session.access_token}` from
`supabase.auth.getSession()` (web relies on cookies; mobile has no cookie jar).
The web routes call `supabase.auth.getUser()`, which reads the bearer token when
present — **verify `createSupabaseServerClient` honors the `Authorization`
header** (it should, via `@supabase/ssr`); if not, that is a tiny server-side
adjustment owned by this slice. Base URL from `EXPO_PUBLIC_WEB_BASE_URL`.

### react-query usage
The streaming Tanya flow is **imperative** (a `useMutation` whose `mutationFn`
runs the stream and updates local message state via `setMessages`), not a cached
query — mirroring `ChatDock`'s imperative pipeline. Capture is a `useMutation`
returning the `Proposal`. The **snippet** is a real cached query:

```
queryKey: assistantKeys.snippet(cardId, eventIds)
queryFn:  () => getCardSnippet(supabase, { cardId, eventIds })   // core, anon client
staleTime: 5 min (snippets rarely change within a session)
```

Per LOCKED DECISION 3, the QueryClient uses an **AsyncStorage persister**
mirroring web's idb-keyval persistence (`apps/web/lib/query/persister.ts`,
`idb-kv.ts`). The chat thread itself is persisted separately (see §8) because it
is local UI state, not server cache — same split web makes (`localStorage` thread
vs idb query cache).

### Realtime
The assistant is request/response; there is no realtime channel for the chat
itself (web has none). **However**, a committed proposal writes a `card_event`,
so after commit the mobile client should invalidate the board/card queries
(`keys.board(code)`, `keys.card(code, slug)`) the same way the Card/Board slices'
realtime + invalidation conventions do — this is delegated to those slices'
mutation hooks (§11). No new channel is introduced by the assistant slice.

### Optimistic updates
- **User bubble** appears immediately on send (web `send()` pushes the user
  message before the request) — local optimistic, no rollback needed.
- **Streaming assistant bubble** grows from deltas (optimistic-by-nature).
- **ProposalCard commit** is NOT optimistic against the board: it shows a local
  `saving` state and only reports `saved` after the core mutation resolves
  (matching web `ProposalCard.commit`). Board cache invalidation happens on
  success.

---

## 6. Mutations & validation — reuse Zod from `@datum/core`

- **Tanya request** validated client-side with `ChatRequest`
  (`core/assistant/schemas.ts`) before POST; server re-validates (defense in
  depth, exactly as web does).
- **Catat request** validated with `CaptureRequest` (mirrors `Body` in
  `capture/route.ts`: `text` 1..4000, file ≤ 20MB). Mobile must compute
  `file.size`/`mime` from the Expo picker result before sending the `file` hint.
- **Proposal payload** is already validated **server-side** in the capture route
  against `EventPayloadSchemas[kind]` (`@datum/types`), so the proposal mobile
  receives is trusted. The commit path re-uses the **card mutation schemas** owned
  by the Card slice (§11). The assistant slice does not define new mutation
  schemas — it forwards the validated proposal.
- `EVENT_KINDS`, `HIGH_RISK_KINDS`, `EventPayloadSchemas`, `EventKind` come from
  `@datum/types` (`packages/types/src/event-kinds.ts`) — already a mobile dep.

---

## 7. RLS & permissions notes (per role)

The web routes gate on **staff membership**, not role: any authenticated user
with a `staff` row (`staff.id === auth.users.id`) may use Tanya and Catat
(`message/route.ts` lines 33–44; `capture/route.ts` 62–66). Mobile inherits this:

- **principal / designer / staff** — all may Ask and Capture. High-risk capture
  kinds (`HIGH_RISK_KINDS`) write the event with a label and notify the principal
  (no draft gate) — `ProposalCard` shows the "Berisiko tinggi · principal akan
  dinotifikasi" badge for everyone; the write itself is allowed for all staff,
  same as web.
- **non-staff authenticated user** — server returns `403 no_staff_record` with
  Indonesian copy ("Akun Anda belum terdaftar sebagai staf di DATUM."); mobile
  renders it as a critical bubble (no retry — it is a 4xx).
- **Retrieval & snippet reads** are RLS-scoped: `retrieveProjectContext` and
  `getCardSnippet` run under the caller's token, so cost-visibility gating on
  events/attachments is enforced by RLS (retrieval.ts comment lines 121–122). When
  mobile calls `getCardSnippet` directly with its **anon client**, RLS applies
  identically — no privilege escalation versus the web API path.
- **Commit writes** (createCard/createCardEvent/upload/link) go through the anon
  client under RLS; the same insert policies that protect web protect mobile.

---

## 8. Offline behavior

Mirror `ChatDock` + `offline-queue.ts` exactly, with RN storage:

- **Send queue**: on a network failure (RN `fetch` reject / first-byte timeout),
  tag a `NetworkError` and `enqueue` the `{mode,text,ts}` into AsyncStorage
  (`core/assistant/offline-queue.ts`, `QueueStorage` = AsyncStorage). The user
  bubble stays; an amber `QUEUED_NOTICE` bubble announces it. **No "Coba lagi"** —
  the drain auto-resends.
- **Drain**: on reconnect, resend oldest-first, one at a time, stopping on the
  first network failure. Tanya items older than `TANYA_MAX_AGE_MS` (30 min) are
  pruned; Catat notes are never dropped by age (`drain`). Guards mirror web:
  `drainingRef`, `busyRef`, `inFlightIds` (remove-on-success so a crash can't lose
  a note). Trigger source on mobile is **`@react-native-community/netinfo`**
  `addEventListener` (replacing web's `window "online"` event); also drain on app
  foreground (`AppState` "active").
- **4xx during drain**: the server rejected it — drop the item and surface an
  error bubble (web `drainQueue` lines 378–390). Same on mobile.
- **Thread + session persistence**: persist `{sessionId, messages}` to
  AsyncStorage under `datum.chat.<projectId>` (web uses `localStorage` same key),
  capped at `STORED_MESSAGE_CAP=30`, via the `toStorable`/`isStoredMessage`
  filtering rules (drop transient error bubbles; collapse proposals to a trace
  line so a reload can't double-save; un-flag streaming). Since AsyncStorage is
  async, hydration is awaited before the first persist (web's `hydrated` flag).
- **Snippet cache** survives offline via the react-query AsyncStorage persister,
  so cited cards still render their last-known snippet with no network.

---

## 9. Edge cases

- **First-byte timeout 20s** (`FIRST_BYTE_TIMEOUT_MS`) but **no body timeout** —
  once streaming starts there is no deadline (web `fetchWithRetry` clears the
  timer on first byte). Replicate with an `AbortController` armed only until the
  first chunk.
- **Stream cut off before `done`** → "Koneksi terputus sebelum jawaban selesai."
  (web `runTanya` line 267). Half-streamed bubble is finalized (un-flag
  `streaming`).
- **Model returns no text but a `done`** → push "(tidak ada jawaban)" bubble
  (web lines 240–243).
- **Partial citation token mid-stream** — `stripCitationTokens` only hides
  complete `[card:UUID]` tokens, so a half-arrived token shows briefly then
  disappears (web comment lines 21–25). Keep that behavior.
- **`assistant_not_configured` (503)** — server has no `ANTHROPIC_API_KEY`; render
  the Indonesian config message; do not retry (it is not 5xx-transient in intent,
  but note web's `fetchWithRetry` DOES retry 5xx including 503 twice before
  surfacing — keep that to match exactly).
- **Capture with no cards** → `{ok:false, error:"Belum ada kartu di proyek ini —
  buat kartu dulu"}` (capture route line 77) → plain bubble.
- **AI picked a non-existent card / invalid kind / invalid payload** — server
  returns `{ok:false,error}`; mobile shows it. These never reach commit.
- **Template placeholder → createNew** — ProposalCard shows an editable title
  prefilled with the WIB-dated `newCardTitle`; empty title blocks save
  ("Judul kartu tidak boleh kosong"). Missing `topicId` blocks save.
- **Low confidence (<50%)** — two-tap arm/confirm before any write.
- **Area link failure after a successful event write** — surface softly, still
  mark saved (web `commit` lines 183–195). Don't discard the saved event.
- **Attachment upload**: RN has no `File`; use the picker asset's `uri` + derived
  `name`/`mime`/`size`. 20MB cap enforced client-side before sending the file
  hint. HEIC photos from iOS should be sent with their real mime (or converted) so
  the `image/*` server hint and downstream captioning behave.
- **Double-send protection** — `inFlightIds` + remove-on-success; AsyncStorage
  reads are async so guard against an overlapping drain reading a stale queue.
- **App backgrounded mid-stream** — RN may suspend the request; on resume the
  unfinished bubble is finalized and (if it never reached the server) re-queued.

---

## 10. Testing

Per the brief: vitest for core, `@testing-library/react-native` for screens
(`@testing-library/react-native` is already a mobile devDep; jest-expo is the
runner — `apps/mobile/jest.config.js`). Core logic is tested with vitest in
`packages/core`.

### Core (vitest, `packages/core`)
- `protocol.test.ts` — `parseStreamLine` round-trips each NDJSON shape and
  returns `null` for junk; `extractCitations` parity tests ported from any
  existing web tests; `stripCitationTokens` keeps partial tokens, removes
  complete ones.
- `offline-queue.test.ts` — port the existing web offline-queue tests against an
  in-memory `QueueStorage`: cap/overflow, Tanya age-pruning, Catat never dropped,
  `drain` non-removal, `remove` no-op on missing id, corrupt-storage → empty.
- `schemas.test.ts` — `ChatRequest`/`CaptureRequest` accept/reject boundaries
  (question ≤2000, text ≤4000, file ≤20MB, uuid).
- `snippet.test.ts` — `getCardSnippet` with a mocked `SupabaseClient` returns the
  shaped object / `null` on not-found.
- **Web regression**: after repointing, run the existing `apps/web` assistant/
  offline-queue tests to prove the strangler step didn't change behavior.

### Mobile screens (@testing-library/react-native)
- `AssistantChat` — mode toggle; sending pushes a user bubble; a mocked stream
  (feed `parseStreamLine`-able lines through a fake transport) grows the assistant
  bubble and finalizes on `done`; `error` event → critical bubble + "Coba lagi";
  network failure → amber queued bubble + queue badge; project-picker shown when
  no current project.
- `ProposalCard` — confidence chip color thresholds; high-risk badge; low-conf
  two-tap gate; createNew title editing + empty-title block; area `Switch`
  default-on; commit calls mocked core mutations in order; saved state shows
  "Buka kartu".
- `CardSnippet` — renders events from a mocked `getCardSnippet`; URL chip opens
  via mocked `expo-web-browser`.
- Offline integration — mock NetInfo offline→online; queued item drains and the
  badge clears.

---

## 11. Dependencies on other slices + Out of scope

### Depends on
- **Card / Board slice** — owns the `@datum/core` extraction of the commit
  mutations the ProposalCard needs: `createCard`, `createCardEvent`,
  `attachToEvent` (from `apps/web/lib/cards/mutations.ts`), `uploadCardAttachment`
  (`apps/web/lib/cards/upload.ts`), `linkCardToArea`
  (`apps/web/lib/cards/area-link-mutations.ts`), plus `isTemplateCardTitle` /
  `deriveCardLabel` (`apps/web/lib/cards/template-card.ts`). This slice **consumes**
  their core versions; it does not extract the 1090-line `mutations.ts` god-module
  itself (that's the strangler work owned by the card slices). If those core
  modules don't exist yet when this slice lands, the ProposalCard commit can call
  the web mutation server actions via a thin web-API shim as an interim, but the
  target is core.
- **Matrix / project-selection slice** — provides "current project"
  (`projectId` + `projectCode`) app state. The assistant tab needs it; until it
  exists, the assistant tab ships its own minimal project picker (recent projects
  via the projects query).
- **App-shell / providers slice** — QueryClient + AsyncStorage persister
  (LOCKED DECISION 3), NativeWind + SANO tokens (LOCKED DECISION 2), NetInfo
  provider, `EXPO_PUBLIC_WEB_BASE_URL` env wiring. If not yet present, this slice
  stands up the minimal pieces it needs.

### Out of scope
- Reimplementing Anthropic streaming on-device (explicitly rejected — key must
  stay server-side).
- Moving `retrieval.ts` / `audit.ts` into core (kept server-side; the web routes
  mobile calls already run them).
- The 1090-line `apps/web/lib/cards/mutations.ts` strangler split (owned by Card
  slices).
- Multi-project / cross-project assistant, voice input, push-notification surfaced
  answers, and assistant history browsing UI (no web equivalent today).
- Server-side changes beyond (a) confirming the assistant routes accept a Bearer
  token from `createSupabaseServerClient`, and (b) bootstrapping `@datum/core`.
