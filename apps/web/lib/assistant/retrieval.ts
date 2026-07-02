import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Card, CardEvent } from "@datum/db";
import { getAdvisorData } from "@/lib/advisor/queries";
import { getProjectAreas } from "@/lib/projects/area-queries";
import {
  getProjectStepSignals,
  getRoomStepViews,
  getAreaStepEventsForAreas,
  type ProjectStepSignalRow,
  type AreaStepRow,
  type AreaStepEventRow,
} from "@/lib/steps/queries";
import { getProjectForecast, type ProjectForecast } from "@/lib/steps/forecast-queries";

export type CardWithEvents = {
  card: Card;
  topicName: string;
  events: CardEvent[];
  /** AI captions for an event's attachments, keyed by event id. */
  captionsByEventId?: Record<string, string[]>;
};

const MAX_CARDS_IN_CONTEXT = 40;       // bumped from 30
const MAX_EVENTS_PER_CARD = 8;
const KEYWORD_HITS_CAP = 20;           // how many extra cards to pull via keyword

/** Max readiness signal rows injected into context (token budget). */
const MAX_READINESS_SIGNALS = 15;

// ─── Severity label map (Bahasa Indonesia) ───────────────────────────────────
const SEVERITY_LABEL: Record<string, string> = {
  critical: "KRITIS",
  high:     "TINGGI",
  warning:  "PERHATIAN",
  info:     "INFO",
};

/**
 * Format a flat list of readiness signal rows into a concise context section.
 * Pure / side-effect-free — safe to unit-test without Supabase.
 *
 * Returns an empty string when there are no signals.
 * Caps to the top `MAX_READINESS_SIGNALS` rows (caller should pre-sort by severity).
 */
export function formatReadinessSignals(rows: ProjectStepSignalRow[]): string {
  if (rows.length === 0) return "";

  const capped = rows.slice(0, MAX_READINESS_SIGNALS);
  const lines: string[] = ["PENGINGAT KESIAPAN / READINESS SIGNALS:"];
  for (const row of capped) {
    const label = SEVERITY_LABEL[row.signal.severity] ?? row.signal.severity.toUpperCase();
    lines.push(`[${label}] ${row.areaName} · ${row.stepName}: ${row.signal.message}`);
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// PM-grade project context — Phase 3 Task 1.
//
// Four compact KONTEKS sections so the assistant sees the whole project, not
// just cards/events: LANGKAH PER RUANGAN (steps), KEPUTUSAN TERBUKA
// (decisions), PENGADAAN/ORDER (procurement), PERKIRAAN (forecast).
//
// All four are pure formatters over already-fetched rows — safe to unit-test
// without Supabase — plus one async orchestrator (buildPmContextSections)
// that runs the fetches on the caller's RLS-scoped client (never admin).
//
// Citation contract: extractCitations (packages/core/src/assistant/protocol.ts)
// only recognizes [card:UUID] and [event:UUID] tokens. Steps/rooms have no
// citable id of their own here, so they are named in plain text; card-linked
// items (open decisions raised on a card) keep citing via [card:UUID].
// ═══════════════════════════════════════════════════════════════════════════

const MAX_ROOMS_FULL_DETAIL = 12;
const MAX_PENDING_STEPS_PER_ROOM = 3;
const MAX_OPEN_DECISIONS = 10;
const MAX_PROCUREMENT_ROWS = 10;

const STEP_STATUS_LABEL: Record<string, string> = {
  not_started: "belum mulai",
  in_progress: "berjalan",
  blocked: "terblokir",
  stalled: "macet",
  done_with_defects: "selesai dgn catatan",
  accepted: "selesai",
  not_applicable: "n/a",
};

const DONE_STEP_STATUSES = new Set(["accepted", "done_with_defects", "not_applicable"]);

function stepStatusLabel(status: string): string {
  return STEP_STATUS_LABEL[status] ?? status;
}

function stepDateLabel(step: Pick<AreaStepRow, "planned_start" | "planned_end">): string {
  if (step.planned_start && step.planned_end) return `${step.planned_start}→${step.planned_end}`;
  if (step.planned_start) return `mulai ${step.planned_start}`;
  if (step.planned_end) return `selesai ${step.planned_end}`;
  return "belum dijadwalkan";
}

/** True when the step's newest event (rows are occurred_at-desc, so events[0]) is AI-sourced. */
function isAiSourced(events: AreaStepEventRow[] | undefined): boolean {
  return events !== undefined && events.length > 0 && events[0]!.source === "ai";
}

function formatStepLine(step: AreaStepRow, events: AreaStepEventRow[] | undefined): string {
  const ai = isAiSourced(events) ? " [AI]" : "";
  return `${step.name} — ${stepStatusLabel(step.status)} · ${stepDateLabel(step)}${ai}`;
}

/** One room's worth of step data for the LANGKAH PER RUANGAN section. */
export type RoomStepContext = {
  areaId: string;
  areaName: string;
  /** Steps worth acting on now (in_progress/blocked/stalled/ready-to-start) — see activeSteps(). */
  active: AreaStepRow[];
  /** All of the room's steps, template-sorted — used to derive "next pending". */
  steps: AreaStepRow[];
};

/**
 * LANGKAH PER RUANGAN: per room, its active steps + next N not-started steps,
 * with planned dates, status, and an [AI] marker when the governing event was
 * AI-authored. Rooms named in the question (focusAreaIds) get every active +
 * pending step; other rooms are capped to keep the whole section under budget.
 *
 * Pure — `eventsByAreaStep` is the caller-supplied map from
 * getAreaStepEventsForAreas (keyed by area_step_id).
 */
export function formatRoomSteps(
  rooms: RoomStepContext[],
  eventsByAreaStep: Map<string, AreaStepEventRow[]>,
  focusAreaIds: Set<string> = new Set(),
): string {
  if (rooms.length === 0) return "";

  const lines: string[] = ["LANGKAH PER RUANGAN:"];
  let truncatedRooms = 0;

  rooms.forEach((room, idx) => {
    const isFocus = focusAreaIds.has(room.areaId);
    if (!isFocus && idx >= MAX_ROOMS_FULL_DETAIL) {
      truncatedRooms++;
      return;
    }

    const pending = room.steps
      .filter((s) => s.status === "not_started")
      .slice(0, isFocus ? undefined : MAX_PENDING_STEPS_PER_ROOM);
    const pendingTotal = room.steps.filter((s) => s.status === "not_started").length;

    if (room.active.length === 0 && pending.length === 0) return;

    lines.push(`- ${room.areaName}:`);
    for (const s of room.active) {
      lines.push(`  · [aktif] ${formatStepLine(s, eventsByAreaStep.get(s.id))}`);
    }
    for (const s of pending) {
      lines.push(`  · [berikutnya] ${formatStepLine(s, eventsByAreaStep.get(s.id))}`);
    }
    if (!isFocus && pendingTotal > pending.length) {
      lines.push(`  · +${pendingTotal - pending.length} langkah lain menunggu`);
    }
  });

  if (truncatedRooms > 0) lines.push(`+${truncatedRooms} ruangan lainnya`);
  return lines.length > 1 ? lines.join("\n") : "";
}

/** One open-decision row — either a card-raised decision event or an unfinished decision-type step. */
export type OpenDecisionRow = {
  /** Present for card-raised decisions so the text can carry a [card:UUID] citation. */
  cardId?: string;
  title: string;
  detail?: string;
  areaName?: string;
};

/**
 * KEPUTUSAN TERBUKA: decision-kind card events still needs_decision, plus
 * decision-type steps not yet done. Card-linked rows keep their [card:UUID]
 * citation so extractCitations still resolves them; step-only rows are named
 * in plain text (no citable id).
 */
export function formatOpenDecisions(rows: OpenDecisionRow[]): string {
  if (rows.length === 0) return "";

  const capped = rows.slice(0, MAX_OPEN_DECISIONS);
  const lines: string[] = ["KEPUTUSAN TERBUKA:"];
  for (const row of capped) {
    const prefix = row.cardId ? `[card:${row.cardId}] ` : "";
    const where = row.areaName ? ` (${row.areaName})` : "";
    const detail = row.detail ? ` — ${row.detail}` : "";
    lines.push(`- ${prefix}${row.title}${where}${detail}`);
  }
  if (rows.length > capped.length) lines.push(`+${rows.length - capped.length} lainnya`);
  return lines.join("\n");
}

/** One procurement-type step, plus whether it currently carries a lead-time-risk signal. */
export type ProcurementRow = {
  areaName: string;
  step: AreaStepRow;
  leadTimeRisk?: { message: string } | null;
};

/**
 * PENGADAAN/ORDER: procurement-type steps, not-started-with-lead-time-risk
 * first (they block a successor if not ordered now), then other open
 * procurement steps, then done ones are dropped entirely (no action needed).
 */
export function formatProcurement(rows: ProcurementRow[]): string {
  const open = rows.filter((r) => !DONE_STEP_STATUSES.has(r.step.status));
  if (open.length === 0) return "";

  const sorted = [...open].sort((a, b) => {
    const ar = a.leadTimeRisk ? 0 : 1;
    const br = b.leadTimeRisk ? 0 : 1;
    return ar - br;
  });

  const capped = sorted.slice(0, MAX_PROCUREMENT_ROWS);
  const lines: string[] = ["PENGADAAN/ORDER:"];
  for (const row of capped) {
    const risk = row.leadTimeRisk ? ` [RISIKO LEAD TIME] ${row.leadTimeRisk.message}` : "";
    const trade = row.step.assigned_trade ? ` · ${row.step.assigned_trade}` : "";
    lines.push(`- ${row.step.name} (${row.areaName}) — ${stepStatusLabel(row.step.status)} · ${stepDateLabel(row.step)}${trade}${risk}`);
  }
  if (sorted.length > capped.length) lines.push(`+${sorted.length - capped.length} lainnya`);
  return lines.join("\n");
}

/**
 * PERKIRAAN: project-wide forecast — projected handover vs target, slip
 * days, and the worst-area bottleneck (reusing summarizeProjectRisk's
 * severity-sorted signal[0], same source /risiko uses).
 */
export function formatForecast(
  forecast: ProjectForecast,
  bottleneck: { areaName: string; stepName: string; message: string } | null,
): string {
  if (forecast.targetHandover === null && forecast.projectedHandover === null) return "";

  const lines: string[] = ["PERKIRAAN:"];
  if (forecast.targetHandover) lines.push(`Target handover: ${forecast.targetHandover}`);
  if (forecast.projectedHandover) lines.push(`Perkiraan handover: ${forecast.projectedHandover}`);
  if (forecast.slipDays != null) {
    lines.push(
      forecast.slipDays > 0
        ? `Perkiraan mundur ${forecast.slipDays} hari dari target`
        : "Sesuai target — tidak ada perkiraan mundur",
    );
  }
  if (bottleneck) {
    lines.push(`Penyebab utama: ${bottleneck.areaName} · ${bottleneck.stepName} — ${bottleneck.message}`);
  }
  return lines.join("\n");
}

/**
 * Match a free-text question against area names — simple normalized
 * substring match (lowercase, diacritics stripped) so "kamar mandi utama"
 * in a question matches an area named "Kamar Mandi Utama". Used for the
 * room-bias: a named room gets full step detail instead of the capped view.
 */
export function matchAreaIdsInQuestion(
  question: string | undefined,
  areas: { id: string; area_name: string }[],
): Set<string> {
  const matched = new Set<string>();
  if (!question) return matched;
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const q = norm(question);
  for (const a of areas) {
    const name = norm(a.area_name);
    if (name.length >= 2 && q.includes(name)) matched.add(a.id);
  }
  return matched;
}

/**
 * Async orchestrator: fetches steps/decisions/procurement/forecast on the
 * CALLER'S RLS-scoped `supabase` client (never admin — same rule as every
 * other retrieval query in this file) and assembles the four sections above
 * into one combined block. Degrades to "" per-section on error so one flaky
 * source can't take down the whole context (mirrors advisorPromise/
 * readinessPromise's .catch(() => "") in retrieveProjectContext).
 */
async function buildPmContextSections(
  supabase: SupabaseClient<Database>,
  projectId: string,
  today: string,
  question?: string,
): Promise<string> {
  const areas = await getProjectAreas(supabase, projectId).catch(() => []);
  if (areas.length === 0) return "";

  const focusAreaIds = matchAreaIdsInQuestion(question, areas);
  const rooms = areas.map((a) => ({ areaId: a.id, areaType: a.area_type }));

  const [roomViews, eventsByAreaStep, signals, forecast] = await Promise.all([
    getRoomStepViews(supabase, projectId, rooms).catch(
      () => new Map() as Awaited<ReturnType<typeof getRoomStepViews>>,
    ),
    getAreaStepEventsForAreas(supabase, areas.map((a) => a.id)).catch(() => new Map<string, AreaStepEventRow[]>()),
    getProjectStepSignals(supabase, projectId, today).catch(() => [] as ProjectStepSignalRow[]),
    getProjectForecast(supabase, projectId, today).catch(
      () => ({ projectId, targetHandover: null, projectedHandover: null, slipDays: null, worstArea: null, areas: [] }) as ProjectForecast,
    ),
  ]);

  // ── LANGKAH PER RUANGAN ──────────────────────────────────────────────────
  const roomContexts: RoomStepContext[] = areas.map((a) => {
    const view = roomViews.get(a.id);
    return { areaId: a.id, areaName: a.area_name, active: view?.active ?? [], steps: view?.steps ?? [] };
  });
  const langkahSection = formatRoomSteps(roomContexts, eventsByAreaStep, focusAreaIds);

  // ── KEPUTUSAN TERBUKA ─────────────────────────────────────────────────────
  const decisionEventRows = await fetchOpenDecisionEvents(supabase, projectId);
  const decisionStepRows: OpenDecisionRow[] = [];
  for (const a of areas) {
    const steps = roomViews.get(a.id)?.steps ?? [];
    for (const s of steps) {
      if (s.step_type !== "decision") continue;
      if (DONE_STEP_STATUSES.has(s.status)) continue;
      decisionStepRows.push({
        title: s.name,
        areaName: a.area_name,
        detail: `${stepStatusLabel(s.status)} · ${stepDateLabel(s)}`,
      });
    }
  }
  const keputusanSection = formatOpenDecisions([...decisionEventRows, ...decisionStepRows]);

  // ── PENGADAAN/ORDER ───────────────────────────────────────────────────────
  // Keyed by `${areaId}:${stepCode}` — step_code alone is NOT unique per
  // project (the same template step recurs across every room that
  // instantiates it; uniqueness is (area_id, step_code)). Keying by stepCode
  // alone would let room A's lead-time-risk marker bleed onto room B's
  // same-coded step.
  const leadTimeRiskByAreaStep = new Map<string, { message: string }>();
  for (const row of signals) {
    if (row.signal.kind === "lead_time_risk") {
      leadTimeRiskByAreaStep.set(`${row.areaId}:${row.stepCode}`, { message: row.signal.message });
    }
  }
  const procurementRows: ProcurementRow[] = [];
  for (const a of areas) {
    const steps = roomViews.get(a.id)?.steps ?? [];
    for (const s of steps) {
      if (s.step_type !== "procurement") continue;
      procurementRows.push({
        areaName: a.area_name,
        step: s,
        leadTimeRisk: leadTimeRiskByAreaStep.get(`${a.id}:${s.step_code}`) ?? null,
      });
    }
  }
  const pengadaanSection = formatProcurement(procurementRows);

  // ── PERKIRAAN ──────────────────────────────────────────────────────────────
  const worst = signals[0]; // getProjectStepSignals is already severity-sorted
  const bottleneck = worst
    ? { areaName: worst.areaName, stepName: worst.stepName, message: worst.signal.message }
    : null;
  const perkiraanSection = formatForecast(forecast, bottleneck);

  return [langkahSection, keputusanSection, pengadaanSection, perkiraanSection].filter(Boolean).join("\n\n");
}

/**
 * Open (needs_decision) decision events for the project, joined to their
 * card for the [card:UUID] citation + title fallback. Mirrors get-advisor.ts's
 * decisionQ shape/cap (PER_SOURCE_CAP=25 there); capped tighter here
 * (MAX_OPEN_DECISIONS) since formatOpenDecisions truncates anyway.
 */
async function fetchOpenDecisionEvents(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<OpenDecisionRow[]> {
  const { data, error } = await supabase
    .from("card_events")
    .select("id, payload, occurred_at, cards:card_id (id, title)")
    .eq("project_id", projectId)
    .eq("event_kind", "decision")
    .contains("payload", { status: "needs_decision" })
    .order("occurred_at", { ascending: true })
    .limit(MAX_OPEN_DECISIONS);
  if (error) return [];

  return (data ?? []).map((e) => {
    const c = (e as unknown as { cards: { id: string; title: string } | null }).cards;
    const p = e.payload as { topic?: string; proposed_spec?: string };
    return {
      cardId: c?.id,
      title: p.topic ?? c?.title ?? "(kartu)",
      detail: p.proposed_spec,
    };
  });
}

// ─── Side-channel state attached to card arrays ───────────────────────────────
// Both the advisor and readiness sections ride along with the cards array via
// WeakMaps keyed on the exact array instance, so retrieveProjectContext and
// buildContextBlock keep their public signatures (the API routes call them as
// a pair: the block returned for a retrieved card set automatically carries
// that project's priorities). Entries are GC'd with the arrays themselves.
const advisorSectionByCards = new WeakMap<CardWithEvents[], string>();
const readinessSectionByCards = new WeakMap<CardWithEvents[], string>();
/** Combined LANGKAH/KEPUTUSAN/PENGADAAN/PERKIRAAN block — see buildPmContextSections. */
const pmContextByCards = new WeakMap<CardWithEvents[], string>();

/**
 * Compute Asia/Jakarta today as YYYY-MM-DD (UTC+7, no DST).
 * Exported so the assistant route can share the same clock.
 */
export function jakartaToday(now: Date = new Date()): string {
  const jakartaMs = now.getTime() + 7 * 60 * 60 * 1000;
  return new Date(jakartaMs).toISOString().slice(0, 10);
}

/**
 * Retrieve cards for the assistant's context.
 * Always includes the N most-recent active cards.
 * If a query is provided, ALSO pulls cards whose title / current_summary /
 * event payload text matches the query, merged dedup.
 */
export async function retrieveProjectContext(
  supabase: SupabaseClient<Database>,
  projectId: string,
  query?: string,
  opts?: { includeAdvisor?: boolean },
): Promise<CardWithEvents[]> {
  const now = new Date();
  const today = jakartaToday(now);

  // 0. "Hari Ini" advisor + gate-deadline context — kicked off first so its
  // internal Promise.all overlaps the card queries below; attached to the
  // result right before returning (see advisorSectionByCards). The capture
  // route skips it: proposals don't use the priority section.
  const advisorPromise = opts?.includeAdvisor === false
    ? Promise.resolve("")
    : buildAdvisorSections(supabase, projectId, now).catch(() => "");

  // 0b. Readiness signals — severity-sorted, cap to top 15 for token budget.
  const readinessPromise = getProjectStepSignals(supabase, projectId, today, now.toISOString())
    .then((rows) => formatReadinessSignals(rows))
    .catch(() => "");

  // 0c. PM-grade project context — steps per room, open decisions,
  // procurement/lead-time risk, forecast (Phase 3 Task 1). Runs on the same
  // caller-scoped `supabase` client — never admin. Room-biased toward any
  // area named in the question. Degrades to "" on failure like the sections
  // above so a flaky source can't take down retrieval.
  const pmContextPromise = buildPmContextSections(supabase, projectId, today, query).catch(() => "");

  // 1. Always: newest-active cards
  const { data: newest, error: nErr } = await supabase
    .from("cards")
    .select("*, topics!inner(name)")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CARDS_IN_CONTEXT);
  if (nErr) throw nErr;

  let cards = (newest ?? []) as unknown as (Card & { topics: { name: string } })[];

  // 2. If query: pull keyword hits and merge
  if (query && query.trim().length >= 2) {
    const trimmed = query.trim();
    const pattern = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;

    // 2a. Cards matching title / current_summary
    const { data: cardHits } = await supabase
      .from("cards")
      .select("*, topics!inner(name)")
      .eq("project_id", projectId)
      .eq("status", "active")
      .or(`title.ilike.${pattern},current_summary.ilike.${pattern}`)
      .limit(KEYWORD_HITS_CAP);

    // 2b. Cards whose events' payload text matches (sweep common text fields in one .or() query)
    const eventFields = ["body","description","topic","request_text","what","notes","title","caption"];
    const orTerm = trimmed.replace(/[,()]/g, "").replace(/[%_]/g, (m) => `\\${m}`);
    const orPattern = `*${orTerm}*`;
    const eventHitCardIds = new Set<string>();
    const { data: evHits } = await supabase
      .from("card_events")
      .select("card_id, cards!inner(project_id)")
      .eq("cards.project_id", projectId)
      .or(eventFields.map((f) => `payload->>${f}.ilike.${orPattern}`).join(","))
      .limit(KEYWORD_HITS_CAP * 2);
    for (const row of evHits ?? []) {
      if (typeof (row as { card_id?: string }).card_id === "string") {
        eventHitCardIds.add((row as { card_id: string }).card_id);
      }
      if (eventHitCardIds.size >= KEYWORD_HITS_CAP) break;
    }

    let eventHitCards: typeof cards = [];
    if (eventHitCardIds.size > 0) {
      const { data: extraCards } = await supabase
        .from("cards")
        .select("*, topics!inner(name)")
        .in("id", [...eventHitCardIds])
        .limit(KEYWORD_HITS_CAP);
      eventHitCards = (extraCards ?? []) as unknown as typeof cards;
    }

    // Merge dedup by card id
    const byId = new Map<string, typeof cards[number]>();
    for (const c of cards) byId.set(c.id, c);
    for (const c of (cardHits ?? []) as unknown as typeof cards) byId.set(c.id, c);
    for (const c of eventHitCards) byId.set(c.id, c);
    cards = [...byId.values()];
  }

  if (cards.length === 0) {
    const empty: CardWithEvents[] = [];
    const [advisorStr, readinessStr, pmContextStr] = await Promise.all([
      advisorPromise, readinessPromise, pmContextPromise,
    ]);
    advisorSectionByCards.set(empty, advisorStr);
    readinessSectionByCards.set(empty, readinessStr);
    pmContextByCards.set(empty, pmContextStr);
    return empty;
  }

  // 3. Load events for the merged set
  const cardIds = cards.map((c) => c.id);
  const { data: events, error: eErr } = await supabase
    .from("card_events")
    .select("*")
    .in("card_id", cardIds)
    .order("occurred_at", { ascending: false });
  if (eErr) throw eErr;

  const evByCard = new Map<string, CardEvent[]>();
  for (const e of events ?? []) {
    const arr = evByCard.get(e.card_id) ?? [];
    if (arr.length < MAX_EVENTS_PER_CARD) arr.push(e);
    evByCard.set(e.card_id, arr);
  }

  // Attachment captions for the events actually in context (RLS-scoped, so the
  // cost-visibility gating on the parent event is inherited).
  const contextEventIds: string[] = [];
  for (const arr of evByCard.values()) for (const e of arr) contextEventIds.push(e.id);
  const capByEvent = new Map<string, string[]>();
  if (contextEventIds.length > 0) {
    const { data: caps } = await supabase
      .from("card_attachments")
      .select("card_event_id, ai_caption")
      .in("card_event_id", contextEventIds)
      .not("ai_caption", "is", null);
    for (const row of caps ?? []) {
      const r = row as { card_event_id: string; ai_caption: string | null };
      if (!r.ai_caption) continue;
      const arr = capByEvent.get(r.card_event_id) ?? [];
      arr.push(r.ai_caption);
      capByEvent.set(r.card_event_id, arr);
    }
  }

  const result = cards.map((c) => {
    const { topics, ...cardRow } = c;
    const evs = evByCard.get(c.id) ?? [];
    const captionsByEventId: Record<string, string[]> = {};
    for (const e of evs) {
      const caps = capByEvent.get(e.id);
      if (caps && caps.length > 0) captionsByEventId[e.id] = caps;
    }
    return {
      card: cardRow as Card,
      topicName: topics?.name ?? "",
      events: evs,
      captionsByEventId,
    };
  });
  const [advisorStr, readinessStr, pmContextStr] = await Promise.all([
    advisorPromise, readinessPromise, pmContextPromise,
  ]);
  advisorSectionByCards.set(result, advisorStr);
  readinessSectionByCards.set(result, readinessStr);
  pmContextByCards.set(result, pmContextStr);
  return result;
}

export function buildContextBlock(cards: CardWithEvents[]): string {
  const advisorSections = advisorSectionByCards.get(cards) ?? "";
  const readinessSections = readinessSectionByCards.get(cards) ?? "";
  const pmContextSections = pmContextByCards.get(cards) ?? "";
  if (cards.length === 0) {
    return [
      "Tidak ada kartu yang tersedia untuk proyek ini.",
      pmContextSections,
      readinessSections,
      advisorSections,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const lines: string[] = [];
  for (const { card, topicName, events, captionsByEventId } of cards) {
    lines.push(`## [card:${card.id}] ${card.title} (${topicName})`);
    if (card.current_summary) lines.push(`Ringkasan: ${card.current_summary}`);
    lines.push(`Status: ${card.status}`);
    if (events.length > 0) {
      lines.push("Aktivitas terbaru:");
      for (const e of events) {
        const date = new Date(e.occurred_at).toISOString().slice(0, 10);
        lines.push(`  - [event:${e.id}] ${date} · ${e.event_kind} · ${JSON.stringify(e.payload)}`);
        const caps = captionsByEventId?.[e.id];
        if (caps && caps.length > 0) {
          for (const cap of caps) lines.push(`    Lampiran: ${cap}`);
        }
      }
    }
    lines.push("");
  }
  if (pmContextSections) lines.push(pmContextSections);
  if (readinessSections) lines.push(readinessSections);
  if (advisorSections) lines.push(advisorSections);
  return lines.join("\n");
}

const MAX_ADVISOR_ITEMS_IN_CONTEXT = 5;
const MAX_GATE_DEADLINES_IN_CONTEXT = 5;

async function buildAdvisorSections(
  supabase: SupabaseClient<Database>,
  projectId: string,
  now: Date,
): Promise<string> {
  const { items, upcomingGateCells } = await getAdvisorData(supabase, {
    projectId,
    now,
    limit: MAX_ADVISOR_ITEMS_IN_CONTEXT,
  });

  const lines: string[] = [];
  if (items.length > 0) {
    lines.push("PRIORITAS PROYEK SAAT INI:");
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}${it.dueLabel ? ` (${it.dueLabel})` : ""}`);
    });
  }
  if (upcomingGateCells.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("TENGGAT GATE TERDEKAT:");
    for (const c of upcomingGateCells.slice(0, MAX_GATE_DEADLINES_IN_CONTEXT)) {
      lines.push(`- ${c.areaName} · Gate ${c.gateCode} — target selesai ${c.targetEndDate}`);
    }
  }
  return lines.join("\n");
}
