/**
 * "DENYUT KEMARIN–HARI INI" (the pulse) — the brief's new top section.
 *
 * Live finding: today's real progress (e.g. waterproofing at 80%) appeared
 * nowhere on the brief while 20-month-stale imports dominated the advisor
 * feed. The pulse fixes that by surfacing what actually HAPPENED in the last
 * 48 hours, across every RLS-visible project, grouped project → room/card.
 *
 * Two source kinds feed it:
 *   - step events   (area_step_events) — room/step progress, incl. AI attribution
 *   - card events   (card_events)      — decisions, blockers, notes, etc.
 *
 * Both queries are time-windowed (`gte("occurred_at", since)`), never an
 * unbounded `.in()` over "all visible projects' ids" — the rooms-page lesson
 * from project history: fan-out .in() over huge id sets breaks at scale,
 * time-window filters don't.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type PulseSource = "human" | "ai";

export type PulseEvent = {
  id: string;
  occurredAt: string; // ISO
  kind: "step" | "card";
  projectCode: string;
  projectName: string;
  /** Room name for step events, card title for card events. */
  roomOrCardLabel: string;
  detail: string;
  source: PulseSource;
  /** AI confidence 0–1, present only for source==='ai' step events. */
  confidence?: number | null;
  /** "dari kartu →" target, present only for AI step events with a linked card. */
  cardLink?: { projectCode: string; cardSlug: string } | null;
  href: string;
};

export type PulseRoomGroup = {
  label: string;
  events: PulseEvent[];
};

export type PulseProjectGroup = {
  projectCode: string;
  projectName: string;
  rooms: PulseRoomGroup[];
};

const DEFAULT_MAX_ROWS = 10;

/**
 * Pure: group a flat list of pulse events by project → room/card, capping
 * the TOTAL row count across all groups (not per-group) at `maxRows`,
 * keeping the most-recent events when the cap trims. Projects are ordered
 * by their most-recent event first; rooms within a project preserve first-
 * seen order; events within a room are newest-first.
 */
export function groupPulseEvents(
  events: PulseEvent[],
  maxRows: number = DEFAULT_MAX_ROWS,
): PulseProjectGroup[] {
  const capped = [...events]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, Math.max(0, maxRows));

  const projectOrder: string[] = [];
  const byProject = new Map<
    string,
    { projectName: string; roomOrder: string[]; rooms: Map<string, PulseEvent[]> }
  >();

  for (const ev of capped) {
    if (!byProject.has(ev.projectCode)) {
      byProject.set(ev.projectCode, { projectName: ev.projectName, roomOrder: [], rooms: new Map() });
      projectOrder.push(ev.projectCode);
    }
    const proj = byProject.get(ev.projectCode)!;
    if (!proj.rooms.has(ev.roomOrCardLabel)) {
      proj.rooms.set(ev.roomOrCardLabel, []);
      proj.roomOrder.push(ev.roomOrCardLabel);
    }
    proj.rooms.get(ev.roomOrCardLabel)!.push(ev);
  }

  // Order projects by their most-recent event (capped list is already
  // newest-first overall, so the first occurrence of each project code
  // establishes that ordering — projectOrder already reflects it).
  return projectOrder.map((code) => {
    const proj = byProject.get(code)!;
    return {
      projectCode: code,
      projectName: proj.projectName,
      rooms: proj.roomOrder.map((label) => ({
        label,
        events: proj.rooms.get(label)!,
      })),
    };
  });
}

// ─── Raw-row shapes + mappers ──────────────────────────────────────────────

type RawStepEventRow = {
  id: string;
  status: string;
  note: string | null;
  percent_complete: number | null;
  occurred_at: string | null;
  created_at: string;
  source?: string | null;
  confidence?: number | null;
  area_steps: {
    step_code: string;
    areas: { area_name: string } | null;
    trade_steps: { name: string } | null;
  } | null;
  projects: { project_code: string; project_name: string } | null;
  card_events?: {
    card_id: string;
    cards: { slug: string; projects: { project_code: string } | null } | null;
  } | null;
};

const STATUS_LABEL: Record<string, string> = {
  not_started: "belum mulai",
  in_progress: "sedang berjalan",
  done: "selesai",
  blocked: "terblokir",
};

/** Pure: one area_step_events row → a PulseEvent. */
export function mapStepEventRow(row: RawStepEventRow): PulseEvent | null {
  const proj = row.projects;
  if (!proj) return null;
  const as = row.area_steps;
  const areaName = as?.areas?.area_name ?? "—";
  const stepName = as?.trade_steps?.name ?? as?.step_code ?? "—";
  const statusLabel = STATUS_LABEL[row.status] ?? row.status;
  const pct = row.percent_complete !== null ? Number(row.percent_complete) : null;
  const detail = `${stepName} — ${statusLabel}${pct !== null ? ` (${pct}%)` : ""}`;

  const cardRow = row.card_events?.cards ?? null;
  const cardProjectCode = cardRow?.projects?.project_code ?? null;
  const cardLink =
    cardRow && cardProjectCode ? { projectCode: cardProjectCode, cardSlug: cardRow.slug } : null;

  return {
    id: `step_${row.id}`,
    occurredAt: row.occurred_at ?? row.created_at,
    kind: "step",
    projectCode: proj.project_code,
    projectName: proj.project_name,
    roomOrCardLabel: areaName,
    detail,
    source: row.source === "ai" ? "ai" : "human",
    confidence: row.confidence !== undefined && row.confidence !== null ? Number(row.confidence) : null,
    cardLink,
    href: `/project/${proj.project_code}/rooms`,
  };
}

type RawCardEventRow = {
  id: string;
  event_kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string | null;
  created_at: string;
  cards: {
    slug: string;
    title: string;
    projects: { project_code: string; project_name: string } | null;
  } | null;
};

/**
 * Pure: one card_events row → a PulseEvent, using the same summariser style
 * as `getRecentActivity`'s `summarizeEvent` (kept local/duplicated on
 * purpose — that function lives in ./activity/queries and is tuned for the
 * all-history activity feed, not a 48h pulse; a shared import would couple
 * two call sites with different tuning needs for no real benefit here).
 */
export function mapCardEventRow(row: RawCardEventRow): PulseEvent | null {
  const c = row.cards;
  if (!c?.projects) return null;
  const p = row.payload ?? {};
  const detail = summarizePulseCardEvent(row.event_kind, p);

  return {
    id: `card_${row.id}`,
    occurredAt: row.occurred_at ?? row.created_at,
    kind: "card",
    projectCode: c.projects.project_code,
    projectName: c.projects.project_name,
    roomOrCardLabel: c.title,
    detail,
    source: "human",
    href: `/project/${c.projects.project_code}/cards/${c.slug}`,
  };
}

/** Pure summariser, tuned for the pulse's short row format. */
export function summarizePulseCardEvent(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "decision": return `Keputusan: ${payload.topic ?? ""}`.trim();
    case "work": {
      const status = payload.status as string | undefined;
      if (status === "blocked") return `Terblokir: ${payload.blocked_on ?? payload.description ?? ""}`;
      return String(payload.description ?? payload.status ?? "pekerjaan diperbarui");
    }
    case "client_request": return `Permintaan klien: ${payload.request_text ?? ""}`;
    case "vendor": return `${payload.vendor_name ?? "vendor"} — ${payload.interaction ?? ""}`;
    case "note": return String(payload.body ?? "");
    default: return JSON.stringify(payload).slice(0, 100);
  }
}

const STEP_EVENT_SELECT =
  "id, status, note, percent_complete, occurred_at, created_at, source, confidence, " +
  "area_steps:area_step_id ( step_code, areas:area_id ( area_name ), trade_steps:step_code ( name ) ), " +
  "projects:project_id ( project_code, project_name ), " +
  "card_events:card_event_id ( card_id, cards:card_id ( slug, projects:project_id ( project_code ) ) )";

const STEP_EVENT_SELECT_NO_ATTRIBUTION =
  "id, status, note, percent_complete, occurred_at, created_at, " +
  "area_steps:area_step_id ( step_code, areas:area_id ( area_name ), trade_steps:step_code ( name ) ), " +
  "projects:project_id ( project_code, project_name )";

const CARD_EVENT_SELECT =
  "id, event_kind, payload, occurred_at, created_at, " +
  "cards:card_id ( slug, title, projects:project_id ( project_code, project_name ) )";

/**
 * True when a Supabase/PostgREST error is caused by the attribution schema
 * not existing yet (pre-`db push` prod). Two shapes matter here:
 *   - 42703 / "column … does not exist"  — plain column (source, confidence)
 *   - PGRST200 / "…relationship…"        — the `card_events:card_event_id`
 *     EMBED, which PostgREST reports as a missing relationship (not a missing
 *     column) when `card_event_id` doesn't exist yet.
 * Broader than the web-side isMissingColumnError on purpose: a false positive
 * here only downgrades the pulse to the attribution-free select, while a
 * missed match would throw and take down the WHOLE brief (web + mobile).
 */
function isMissingAttributionSchemaError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code === "42703") return true; // Postgres: undefined_column
  if (error.code === "PGRST200") return true; // PostgREST: missing embed relationship
  const msg = (error.message ?? "").toLowerCase();
  return (msg.includes("column") && msg.includes("does not exist")) || msg.includes("relationship");
}

const PULSE_WINDOW_HOURS = 48;
/**
 * Row cap PER SOURCE query, not the final rendered cap (that's `maxRows` in
 * groupPulseEvents, applied after merging both sources). 200 keeps the
 * query itself bounded even on a busy 48h window across many projects,
 * while comfortably exceeding what the ~10-row rendered cap will ever need.
 */
const PER_SOURCE_QUERY_CAP = 200;

/**
 * Cross-project, 48h-windowed pulse: step events + card events across every
 * RLS-visible project. Time-windowed only (`gte("occurred_at", since)`) —
 * no `.in()` fan-out over project/card ids, per the rooms-page lesson.
 */
export async function getRecentPulse(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
  windowHours: number = PULSE_WINDOW_HOURS,
): Promise<PulseEvent[]> {
  const since = new Date(now.getTime() - windowHours * 3_600_000).toISOString();

  const stepAttribution = await supabase
    .from("area_step_events")
    .select(STEP_EVENT_SELECT)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(PER_SOURCE_QUERY_CAP);

  let stepRows: unknown[] | null = stepAttribution.data as unknown[] | null;
  let stepError = stepAttribution.error;
  if (stepError && isMissingAttributionSchemaError(stepError)) {
    const fallback = await supabase
      .from("area_step_events")
      .select(STEP_EVENT_SELECT_NO_ATTRIBUTION)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(PER_SOURCE_QUERY_CAP);
    stepRows = fallback.data as unknown[] | null;
    stepError = fallback.error;
  }
  if (stepError) throw stepError;

  const { data: cardRows, error: cardError } = await supabase
    .from("card_events")
    .select(CARD_EVENT_SELECT)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(PER_SOURCE_QUERY_CAP);
  if (cardError) throw cardError;

  const events: PulseEvent[] = [];
  for (const r of stepRows ?? []) {
    const mapped = mapStepEventRow(r as unknown as RawStepEventRow);
    if (mapped) events.push(mapped);
  }
  for (const r of cardRows ?? []) {
    const mapped = mapCardEventRow(r as unknown as RawCardEventRow);
    if (mapped) events.push(mapped);
  }
  return events;
}
