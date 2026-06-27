import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type StepActivityItem = {
  id: string;
  occurredAt: string;
  areaName: string;
  stepName: string;
  status: string;
  note: string | null;
  percentComplete: number | null;
  authorName: string | null;
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
};

/** Pure: one DB row → a feed item (occurredAt falls back to created_at; names fall back to step_code). */
export function mapStepActivityRow(row: RawRow): StepActivityItem {
  const as = row.area_steps;
  return {
    id: row.id,
    occurredAt: row.occurred_at ?? row.created_at,
    areaName: as?.areas?.area_name ?? "—",
    stepName: as?.trade_steps?.name ?? as?.step_code ?? "—",
    status: row.status,
    note: row.note,
    percentComplete: row.percent_complete !== null ? Number(row.percent_complete) : null,
    authorName: row.staff?.full_name ?? null,
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

/** The project's step events, newest first, mapped to feed items. */
export async function getProjectStepActivity(
  supabase: SupabaseClient<Database>,
  projectId: string,
  limit = 50,
): Promise<StepActivityItem[]> {
  const { data, error } = await supabase
    .from("area_step_events")
    .select("id, status, note, percent_complete, occurred_at, created_at, area_step_id, area_steps:area_step_id ( step_code, areas:area_id ( area_name ), trade_steps:step_code ( name ) ), staff:logged_by_staff_id ( full_name )")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => mapStepActivityRow(r as unknown as RawRow));
}
