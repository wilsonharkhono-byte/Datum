import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { isMissingColumnError } from "@/lib/steps/queries";
import type { StepEventCardLink } from "@/lib/steps/queries";

export type StepActivityItem = {
  id: string;
  occurredAt: string;
  areaName: string;
  stepName: string;
  status: string;
  note: string | null;
  percentComplete: number | null;
  authorName: string | null;
  /** 'human' | 'ai'. Defaults to 'human' when the column isn't selected (degrade path) or is null. */
  source: string;
  /** AI confidence 0–1, null for human events or when unavailable. */
  confidence: number | null;
  /** "dari kartu →" target; null when not an AI event or the join is unavailable. */
  cardLink: StepEventCardLink | null;
};

type RawRow = {
  id: string;
  status: string;
  note: string | null;
  percent_complete: number | null;
  occurred_at: string | null;
  created_at: string;
  area_step_id: string;
  area_steps: { step_code: string; areas: { area_name: string } | null; trade_steps: { name: string } | null } | null;
  staff: { full_name: string } | null;
  source?: string | null;
  confidence?: number | null;
  card_events?: {
    card_id: string;
    cards: {
      slug: string;
      projects: { project_code: string } | null;
    } | null;
  } | null;
};

/** Pure: one DB row → a feed item (occurredAt falls back to created_at; names fall back to step_code). */
export function mapStepActivityRow(row: RawRow): StepActivityItem {
  const as = row.area_steps;
  const cardRow = row.card_events?.cards ?? null;
  const projectCode = cardRow?.projects?.project_code ?? null;
  const cardLink: StepEventCardLink | null =
    cardRow && projectCode ? { projectCode, cardSlug: cardRow.slug } : null;

  return {
    id: row.id,
    occurredAt: row.occurred_at ?? row.created_at,
    areaName: as?.areas?.area_name ?? "—",
    stepName: as?.trade_steps?.name ?? as?.step_code ?? "—",
    status: row.status,
    note: row.note,
    percentComplete: row.percent_complete !== null ? Number(row.percent_complete) : null,
    authorName: row.staff?.full_name ?? null,
    source: row.source ?? "human",
    confidence: row.confidence !== undefined && row.confidence !== null ? Number(row.confidence) : null,
    cardLink,
  };
}

/** Pure: group items by Asia/Jakarta calendar day, preserving the incoming (newest-first) order. */
export function groupByDay(items: StepActivityItem[]): { day: string; items: StepActivityItem[] }[] {
  const order: string[] = [];
  const byDay = new Map<string, StepActivityItem[]>();
  for (const it of items) {
    const day = new Date(it.occurredAt).toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta", year: "numeric", month: "long", day: "numeric",
    });
    if (!byDay.has(day)) { byDay.set(day, []); order.push(day); }
    byDay.get(day)!.push(it);
  }
  return order.map((day) => ({ day, items: byDay.get(day)! }));
}

const STEP_ACTIVITY_BASE_SELECT =
  "id, status, note, percent_complete, occurred_at, created_at, area_step_id, " +
  "area_steps:area_step_id ( step_code, areas:area_id ( area_name ), trade_steps:step_code ( name ) ), " +
  "staff:logged_by_staff_id ( full_name )";

const STEP_ACTIVITY_ATTRIBUTION_SELECT =
  `${STEP_ACTIVITY_BASE_SELECT}, source, confidence, ` +
  "card_events:card_event_id (card_id, cards:card_id (slug, projects:project_id (project_code)))";

/**
 * The project's step events, newest first, mapped to feed items — including AI attribution
 * (source/confidence) and, for AI events, the originating card's link.
 *
 * Degrades to the pre-attribution select if the attribution columns don't exist yet in prod
 * (before `supabase db push` lands the 2026-06-28 migration): attribution fields fall back to
 * source='human'/confidence=null/cardLink=null so the feed still renders, just without badges.
 */
export async function getProjectStepActivity(
  supabase: SupabaseClient<Database>,
  projectId: string,
  limit = 50,
): Promise<StepActivityItem[]> {
  const attribution = await supabase
    .from("area_step_events")
    .select(STEP_ACTIVITY_ATTRIBUTION_SELECT)
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  let data: unknown[] | null = attribution.data as unknown[] | null;
  let error = attribution.error;

  if (error && isMissingColumnError(error)) {
    const fallback = await supabase
      .from("area_step_events")
      .select(STEP_ACTIVITY_BASE_SELECT)
      .eq("project_id", projectId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    data = fallback.data as unknown[] | null;
    error = fallback.error;
  }
  if (error) throw error;
  return (data ?? []).map((r) => mapStepActivityRow(r as unknown as RawRow));
}
