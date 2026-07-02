import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { computeAreaFlags, type AreaFlags } from "@/lib/steps/flags";
import type { TradeStepDep } from "@/lib/steps/types";
import { computeStepSignals } from "@/lib/steps/signals";
import type { StepSignal } from "@/lib/steps/signals";
import { gateShortName } from "@datum/core";

/** Where to send "dari kartu →" — the card that produced an AI-authored step event. */
export type StepEventCardLink = {
  projectCode: string;
  cardSlug: string;
};

export type AreaStepEventRow = {
  id: string;
  area_step_id: string;
  status: string;
  note: string | null;
  percent_complete: number | null;
  occurred_at: string;
  /** Insert-order tiebreak for occurred_at ties — mirrors the server's `latest()` precedence in lib/steps/status.ts. */
  created_at: string;
  author_name: string | null;
  /** 'human' | 'ai'. Defaults to 'human' when the column isn't selected (degrade path) or is null. */
  source: string;
  /** AI confidence 0–1, null for human events or when unavailable. */
  confidence: number | null;
  card_event_id: string | null;
  /** Resolved href target for "dari kartu →"; null when not an AI event or the join is unavailable. */
  card_link: StepEventCardLink | null;
};

export type AreaStepCheckpoint = {
  id: string;
  item_text: string;
  severity: string;
  required: boolean;
  result: string;
};

export type AreaStepRow = {
  id: string;
  step_code: string;
  name: string;
  step_type: string;
  gate_code: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  assigned_trade: string | null;
  blocking_reason: string | null;
  last_progress_at: string | null;
  checkpoints: AreaStepCheckpoint[];
};

export type CatalogStep = { code: string; name: string };
export type RemovedStep = { id: string; step_code: string; name: string };

/** Pure: standard catalog steps whose code is not already instantiated on the area. */
export function addableCatalog(catalog: CatalogStep[], existingCodes: string[]): CatalogStep[] {
  const have = new Set(existingCodes);
  return catalog.filter((c) => !have.has(c.code));
}

// ─── Private row-mapping helper (DRY: used by getAreaSteps + getRoomStepViews) ──

type RawAreaStepRow = {
  id: string;
  step_code: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  assigned_trade: string | null;
  blocking_reason: string | null;
  last_progress_at: string | null;
  created_at: string;
  trade_steps: { sort_order: number; step_type: string; name: string; gate_code: string } | null;
  area_step_checkpoints: Array<AreaStepCheckpoint & { sort_order: number }> | null;
};

type SortableAreaStepRow = AreaStepRow & { _sort: number; _created: string };

function mapAreaStepRow(r: RawAreaStepRow): SortableAreaStepRow {
  const tmpl = r.trade_steps;
  const cps = r.area_step_checkpoints ?? [];
  return {
    _sort: tmpl?.sort_order ?? 0,
    _created: r.created_at,
    id: r.id,
    step_code: r.step_code,
    name: tmpl?.name ?? r.step_code,
    step_type: tmpl?.step_type ?? "site_work",
    gate_code: tmpl?.gate_code ?? "?",
    status: r.status,
    planned_start: r.planned_start,
    planned_end: r.planned_end,
    assigned_trade: r.assigned_trade,
    blocking_reason: r.blocking_reason,
    last_progress_at: r.last_progress_at,
    checkpoints: [...cps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((c) => ({ id: c.id, item_text: c.item_text, severity: c.severity, required: c.required, result: c.result })),
  };
}

/** Active trade steps instantiated for one area, ordered by template sort_order then created_at, with checkpoints. */
export async function getAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<AreaStepRow[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      assigned_trade, blocking_reason, last_progress_at, created_at,
      trade_steps:step_code (sort_order, step_type, name, gate_code),
      area_step_checkpoints (id, item_text, severity, required, result, sort_order)
    `)
    .eq("area_id", areaId)
    .is("removed_at", null);
  if (error) throw error;

  return (data ?? [])
    .map((r) => mapAreaStepRow(r as unknown as RawAreaStepRow))
    .sort((a, b) => a._sort - b._sort || a._created.localeCompare(b._created))
    .map(({ _sort, _created, ...rest }) => rest as AreaStepRow);
}

/** True when a Supabase/PostgREST error is caused by a column not existing yet (pre-migration prod). */
export function isMissingColumnError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code === "42703") return true; // Postgres: undefined_column
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/** Raw shape returned by the attribution-extended select (source/confidence/card_event_id + card link join). */
type RawAreaStepEventRow = {
  id: string;
  area_step_id: string;
  status: string;
  note: string | null;
  percent_complete: number | null;
  occurred_at: string | null;
  created_at: string;
  staff: { full_name: string } | null;
  source?: string | null;
  confidence?: number | null;
  card_event_id?: string | null;
  card_events?: {
    card_id: string;
    cards: {
      slug: string;
      projects: { project_code: string } | null;
    } | null;
  } | null;
};

/** Pure: one area_step_events row (+ optional attribution/card-link joins) → AreaStepEventRow. */
export function mapAreaStepEventRow(r: RawAreaStepEventRow): AreaStepEventRow {
  const staffRow = r.staff as { full_name: string } | null;
  const cardRow = r.card_events?.cards ?? null;
  const projectCode = cardRow?.projects?.project_code ?? null;
  const cardLink: StepEventCardLink | null =
    cardRow && projectCode ? { projectCode, cardSlug: cardRow.slug } : null;

  return {
    id: r.id,
    area_step_id: r.area_step_id,
    status: r.status,
    note: r.note,
    percent_complete: r.percent_complete !== null ? Number(r.percent_complete) : null,
    occurred_at: r.occurred_at ?? r.created_at,
    created_at: r.created_at,
    author_name: staffRow?.full_name ?? null,
    source: r.source ?? "human",
    confidence: r.confidence !== undefined && r.confidence !== null ? Number(r.confidence) : null,
    card_event_id: r.card_event_id ?? null,
    card_link: cardLink,
  };
}

const AREA_STEP_EVENTS_BASE_SELECT =
  "id, area_step_id, status, note, percent_complete, occurred_at, created_at, staff:logged_by_staff_id (full_name)";

const AREA_STEP_EVENTS_ATTRIBUTION_SELECT =
  `${AREA_STEP_EVENTS_BASE_SELECT}, source, confidence, card_event_id, ` +
  "card_events:card_event_id (card_id, cards:card_id (slug, projects:project_id (project_code)))";

/** area_id-scoped variant of the same selects, via an inner-join embed on area_steps. */
const AREA_STEP_EVENTS_BASE_SELECT_BY_AREA =
  "id, area_step_id, status, note, percent_complete, occurred_at, created_at, staff:logged_by_staff_id (full_name), area_steps!inner (area_id)";

const AREA_STEP_EVENTS_ATTRIBUTION_SELECT_BY_AREA =
  `${AREA_STEP_EVENTS_BASE_SELECT_BY_AREA}, source, confidence, card_event_id, ` +
  "card_events:card_event_id (card_id, cards:card_id (slug, projects:project_id (project_code)))";

/**
 * Shared core: run the attribution-select-with-degrade-fallback query described
 * below and return the grouped-by-area_step_id map. `run(select)` performs one
 * query attempt for the given select string; the caller supplies the two
 * (attribution, fallback) select variants appropriate to its filter (by step id
 * list or by area id list) so this helper doesn't need to know which column is
 * being filtered on.
 */
async function fetchAreaStepEvents(
  run: (select: string) => Promise<{ data: unknown[] | null; error: { code?: string | null; message?: string | null } | null }>,
  attributionSelect: string,
  baseSelect: string,
): Promise<Map<string, AreaStepEventRow[]>> {
  const attribution = await run(attributionSelect);

  let data: unknown[] | null = attribution.data;
  let error = attribution.error;

  if (error && isMissingColumnError(error)) {
    const fallback = await run(baseSelect);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;

  const map = new Map<string, AreaStepEventRow[]>();
  for (const r of data ?? []) {
    const row = mapAreaStepEventRow(r as unknown as RawAreaStepEventRow);
    const bucket = map.get(row.area_step_id) ?? [];
    bucket.push(row);
    map.set(row.area_step_id, bucket);
  }
  return map;
}

/**
 * Fetch all events for an area's steps in one query (one round-trip), joined to staff.full_name
 * plus AI attribution (source/confidence) and, for AI events, the originating card's link
 * (card_event_id -> card_events -> cards -> projects, all in the same round-trip).
 *
 * Degrades to the pre-attribution select if the attribution columns don't exist yet in prod
 * (before `supabase db push` lands the 2026-06-28 migration): attribution fields fall back to
 * source='human'/confidence=null/card_link=null so the page still renders, just without badges.
 * Returns a map keyed by area_step_id for O(1) lookup in the render path.
 * Ordered newest-first within each step.
 *
 * NOTE: filters via `.in("area_step_id", stepIds)` — the URL grows with the number of step ids.
 * For whole-project fan-outs (e.g. the Rooms page, which can have hundreds of steps across many
 * rooms) use `getAreaStepEventsForAreas` instead, which filters on the much smaller area id list
 * and stays well under PostgREST/proxy URL length limits. Keep this one for per-step/per-card
 * callers that already have a short, bounded step id list.
 */
export async function getAreaStepEvents(
  supabase: SupabaseClient<Database>,
  stepIds: string[],
): Promise<Map<string, AreaStepEventRow[]>> {
  if (stepIds.length === 0) return new Map();

  return fetchAreaStepEvents(
    async (select) =>
      await supabase
        .from("area_step_events")
        .select(select)
        .in("area_step_id", stepIds)
        .order("occurred_at", { ascending: false }),
    AREA_STEP_EVENTS_ATTRIBUTION_SELECT,
    AREA_STEP_EVENTS_BASE_SELECT,
  );
}

/**
 * Area-scoped variant of `getAreaStepEvents`: same fields, same degrade path, same
 * return shape (map keyed by area_step_id) — but filters on `area_steps.area_id` via
 * an inner-join embed (`area_steps!inner (area_id)` + `.in("area_steps.area_id", areaIds)`)
 * instead of enumerating every step id.
 *
 * Why: the Rooms page can have hundreds of steps across a project's rooms (e.g. ~958
 * area_steps across 15 rooms on a real project). `getAreaStepEvents(stepIds)` builds a
 * PostgREST GET URL with one UUID per step id in the `.in()` filter, which exceeds the
 * proxy's URL length limit and 500s the whole page ("URI too long"). Filtering on area
 * ids instead keeps the filter list bounded by room count (tens, not hundreds+), which
 * stays comfortably under the limit.
 */
export async function getAreaStepEventsForAreas(
  supabase: SupabaseClient<Database>,
  areaIds: string[],
): Promise<Map<string, AreaStepEventRow[]>> {
  if (areaIds.length === 0) return new Map();

  return fetchAreaStepEvents(
    async (select) =>
      await supabase
        .from("area_step_events")
        .select(select)
        .in("area_steps.area_id", areaIds)
        .order("occurred_at", { ascending: false }),
    AREA_STEP_EVENTS_ATTRIBUTION_SELECT_BY_AREA,
    AREA_STEP_EVENTS_BASE_SELECT_BY_AREA,
  );
}

// ─── Project-wide signal query ────────────────────────────────────────────────

/**
 * One entry in the flat, sorted list returned by `getProjectStepSignals`.
 */
export type ProjectStepSignalRow = {
  areaId: string;
  areaName: string;
  stepCode: string;
  stepName: string;
  /** Matches trade_steps.trade_role — used by the reminder cron for recipient resolution. */
  tradeRole: string | null;
  signal: StepSignal;
};

/**
 * Fetch ALL area_steps for a project (joined to trade_steps template fields +
 * area name), pull the shared dep graph once, run `computeStepSignals` per
 * area in memory, and return a flat severity-sorted list of signals.
 *
 * - One round-trip for the steps+template join.
 * - One round-trip for trade_step_deps.
 * - One round-trip for area names (via matrix_areas).
 * - Grouping + comparator runs entirely in memory.
 *
 * `today` and `now` are supplied by the caller (the server page computes WIB
 * today so this stays pure and testable).
 */
export async function getProjectStepSignals(
  supabase: SupabaseClient<Database>,
  projectId: string,
  today: string,
  now?: string,
): Promise<ProjectStepSignalRow[]> {
  // 1. Fetch all area_steps for the project, joined to trade_steps template.
  const { data: rawSteps, error: stepsErr } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      actual_start, actual_end, blocking_reason, last_progress_at,
      area_id,
      trade_steps:step_code (
        name, step_type, trade_role, lead_time_days, typical_duration_days
      )
    `)
    .eq("project_id", projectId);
  if (stepsErr) throw stepsErr;

  // 2. Fetch dep edges once (shared across all areas).
  const { data: depsRaw, error: depsErr } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");
  if (depsErr) throw depsErr;
  const deps = (depsRaw ?? []) as TradeStepDep[];

  // 3. Fetch area names for all areas that appear in the step list.
  const areaIds = [...new Set((rawSteps ?? []).map((r) => r.area_id))];
  const areaNameMap = new Map<string, string>();
  if (areaIds.length > 0) {
    const { data: areas, error: areasErr } = await supabase
      .from("areas")
      .select("id, area_name")
      .in("id", areaIds);
    if (areasErr) throw areasErr;
    for (const a of areas ?? []) {
      areaNameMap.set(a.id, a.area_name);
    }
  }

  // 4. Group steps by area_id and assemble SignalStep[] per area.
  const byArea = new Map<string, typeof rawSteps>();
  for (const row of rawSteps ?? []) {
    const bucket = byArea.get(row.area_id) ?? [];
    bucket.push(row);
    byArea.set(row.area_id, bucket);
  }

  // 5. Run comparator per area, collect + flatten results.
  const SEVERITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    warning: 2,
    info: 3,
  };

  const allSignalRows: ProjectStepSignalRow[] = [];

  for (const [areaId, areaSteps] of byArea) {
    const areaName = areaNameMap.get(areaId) ?? areaId;

    const signalSteps = (areaSteps ?? []).map((r) => {
      const tmpl = r.trade_steps as {
        name: string;
        step_type: string;
        trade_role: string | null;
        lead_time_days: number;
        typical_duration_days: number;
      } | null;

      return {
        step_code: r.step_code,
        name: tmpl?.name ?? r.step_code,
        step_type: (tmpl?.step_type ?? "site_work") as import("@/lib/steps/types").StepType,
        trade_role: tmpl?.trade_role ?? null,
        lead_time_days: tmpl?.lead_time_days ?? 0,
        typical_duration_days: tmpl?.typical_duration_days ?? 1,
        status: r.status as import("@/lib/steps/types").StepStatus,
        planned_start: r.planned_start ?? null,
        planned_end: r.planned_end ?? null,
        actual_start: r.actual_start ?? null,
        actual_end: r.actual_end ?? null,
        last_progress_at: r.last_progress_at ?? null,
        blocking_reason: r.blocking_reason ?? null,
      };
    });

    const signals = computeStepSignals({ steps: signalSteps, deps, today, now });

    // Build name + trade_role lookups keyed by step_code for the signal rows.
    const stepNameMap = new Map(signalSteps.map((s) => [s.step_code, s.name]));
    const stepTradeRoleMap = new Map(signalSteps.map((s) => [s.step_code, s.trade_role]));

    for (const sig of signals) {
      allSignalRows.push({
        areaId,
        areaName,
        stepCode: sig.stepCode,
        stepName: stepNameMap.get(sig.stepCode) ?? sig.stepCode,
        tradeRole: stepTradeRoleMap.get(sig.stepCode) ?? null,
        signal: sig,
      });
    }
  }

  // 6. Sort overall: critical → high → warning → info, then areaName, stepCode.
  allSignalRows.sort((a, b) => {
    const sev =
      (SEVERITY_ORDER[a.signal.severity] ?? 3) -
      (SEVERITY_ORDER[b.signal.severity] ?? 3);
    if (sev !== 0) return sev;
    const area = a.areaName.localeCompare(b.areaName);
    if (area !== 0) return area;
    return a.stepCode.localeCompare(b.stepCode);
  });

  return allSignalRows;
}

/** Steps for an area plus the per-area flags (siap dimulai / perlu keputusan / blocked). */
export async function getAreaStepView(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<{ steps: AreaStepRow[]; flags: AreaFlags }> {
  const steps = await getAreaSteps(supabase, areaId);
  // Deps are fetched unscoped: trade_step_deps has no gate column (PK is
  // (step_code, predecessor_code)), so there is nothing to filter on here.
  // computeAreaFlags intersects deps against this area's own step_codes, so
  // foreign deps are harmlessly ignored.
  const { data: deps, error } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");
  if (error) throw error;
  const flags = computeAreaFlags(
    steps.map((s) => ({ step_code: s.step_code, step_type: s.step_type, status: s.status })),
    (deps ?? []) as TradeStepDep[],
  );
  return { steps, flags };
}

/** Steps the user soft-removed from this area (for the restore list). */
export async function getRemovedAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<RemovedStep[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select("id, step_code, trade_steps:step_code (name)")
    .eq("area_id", areaId)
    .not("removed_at", "is", null);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const tmpl = r.trade_steps as { name: string } | null;
    return { id: r.id, step_code: r.step_code, name: tmpl?.name ?? r.step_code };
  });
}

/** Firm-standard steps not yet instantiated on this area, filtered to those applicable to the area's type. */
export async function getAddableCatalogSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<CatalogStep[]> {
  const { data: area } = await supabase.from("areas").select("area_type").eq("id", areaId).single();
  const areaType = area?.area_type ?? null;
  const [{ data: existing, error: e1 }, { data: catalog, error: e2 }] = await Promise.all([
    supabase.from("area_steps").select("step_code").eq("area_id", areaId),
    supabase.from("trade_steps").select("code, name, applies_to_area_types")
      .eq("active", true).is("project_id", null).order("gate_code").order("sort_order"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const applicable = (catalog ?? []).filter((c) => {
    const types = (c.applies_to_area_types as string[] | null) ?? null;
    return types === null || (areaType !== null && types.includes(areaType));
  });
  return addableCatalog(
    applicable.map((c) => ({ code: c.code, name: c.name })),
    (existing ?? []).map((r) => r.step_code),
  );
}

/** Group steps by their real gate_code, in A→H order, with done counts. */
export function groupStepsByGate(steps: AreaStepRow[]): { gate: string; gateName: string; steps: AreaStepRow[]; done: number }[] {
  const order: string[] = [];
  const byGate = new Map<string, AreaStepRow[]>();
  for (const s of steps) {
    const gate = s.gate_code || "?";
    if (!byGate.has(gate)) { byGate.set(gate, []); order.push(gate); }
    byGate.get(gate)!.push(s);
  }
  order.sort((a, b) => a.localeCompare(b)); // A→H
  return order.map((gate) => {
    const gs = byGate.get(gate)!;
    const done = gs.filter((s) => s.status === "accepted" || s.status === "done_with_defects").length;
    return { gate, gateName: gateShortName(gate), steps: gs, done };
  });
}

/** The steps worth acting on now: in_progress/blocked/stalled + the readyToStart step. */
export function activeSteps(steps: AreaStepRow[], flags: AreaFlags): AreaStepRow[] {
  return steps.filter((s) =>
    s.status === "in_progress" || s.status === "blocked" || s.status === "stalled" || s.step_code === flags.readyToStart);
}

/** Everything the Rooms-page per-room panel needs. */
export async function getRoomStepView(supabase: SupabaseClient<Database>, areaId: string) {
  const [view, addableCatalog, removedSteps] = await Promise.all([
    getAreaStepView(supabase, areaId),
    getAddableCatalogSteps(supabase, areaId),
    getRemovedAreaSteps(supabase, areaId),
  ]);
  return { ...view, addableCatalog, removedSteps, grouped: groupStepsByGate(view.steps), active: activeSteps(view.steps, view.flags) };
}

/**
 * Batched variant of getRoomStepView for the Rooms page.
 * Issues a fixed number of queries regardless of room count (4 round-trips total):
 *   1. All non-removed area_steps for the project (with template join + checkpoints).
 *   2. All removed area_steps for the project (for the restore list).
 *   3. trade_step_deps once (shared dep graph).
 *   4. Firm-standard catalog once (addable steps).
 * Per-room views are assembled in memory from those 4 fetches.
 */
export async function getRoomStepViews(
  supabase: SupabaseClient<Database>,
  projectId: string,
  rooms: { areaId: string; areaType: string }[],
): Promise<Map<string, Awaited<ReturnType<typeof getRoomStepView>>>> {
  const [rawStepsRes, removedRes, depsRes, catalogRes] = await Promise.all([
    // 1. All non-removed area_steps for the project
    supabase
      .from("area_steps")
      .select(`
        id, step_code, status, planned_start, planned_end,
        assigned_trade, blocking_reason, last_progress_at, created_at,
        area_id,
        trade_steps:step_code (sort_order, step_type, name, gate_code),
        area_step_checkpoints (id, item_text, severity, required, result, sort_order)
      `)
      .eq("project_id", projectId)
      .is("removed_at", null),
    // 2. All removed area_steps for the project
    supabase
      .from("area_steps")
      .select("id, area_id, step_code, trade_steps:step_code (name)")
      .eq("project_id", projectId)
      .not("removed_at", "is", null),
    // 3. trade_step_deps once
    supabase
      .from("trade_step_deps")
      .select("step_code, predecessor_code"),
    // 4. Firm-standard catalog once
    supabase
      .from("trade_steps")
      .select("code, name, applies_to_area_types")
      .eq("active", true)
      .is("project_id", null)
      .order("gate_code")
      .order("sort_order"),
  ]);

  if (rawStepsRes.error) throw rawStepsRes.error;
  if (removedRes.error) throw removedRes.error;
  if (depsRes.error) throw depsRes.error;
  if (catalogRes.error) throw catalogRes.error;

  const deps = (depsRes.data ?? []) as TradeStepDep[];
  const catalogAll = catalogRes.data ?? [];

  // Group non-removed steps by area_id, sorted
  const stepsByArea = new Map<string, AreaStepRow[]>();
  const rawByArea = new Map<string, RawAreaStepRow[]>();
  for (const r of rawStepsRes.data ?? []) {
    const areaId = (r as { area_id: string }).area_id;
    const bucket = rawByArea.get(areaId) ?? [];
    bucket.push(r as unknown as RawAreaStepRow);
    rawByArea.set(areaId, bucket);
  }
  for (const [areaId, raws] of rawByArea) {
    const sorted = raws
      .map((r) => mapAreaStepRow(r))
      .sort((a, b) => a._sort - b._sort || a._created.localeCompare(b._created))
      .map(({ _sort, _created, ...rest }) => rest as AreaStepRow);
    stepsByArea.set(areaId, sorted);
  }

  // Group removed steps by area_id
  const removedByArea = new Map<string, RemovedStep[]>();
  for (const r of removedRes.data ?? []) {
    const areaId = (r as { area_id: string }).area_id;
    const tmpl = r.trade_steps as { name: string } | null;
    const bucket = removedByArea.get(areaId) ?? [];
    bucket.push({ id: r.id, step_code: r.step_code, name: tmpl?.name ?? r.step_code });
    removedByArea.set(areaId, bucket);
  }

  // Build per-room views in memory
  const result = new Map<string, Awaited<ReturnType<typeof getRoomStepView>>>();
  for (const room of rooms) {
    const steps = stepsByArea.get(room.areaId) ?? [];
    const flags = computeAreaFlags(
      steps.map((s) => ({ step_code: s.step_code, step_type: s.step_type, status: s.status })),
      deps,
    );
    const grouped = groupStepsByGate(steps);
    const active = activeSteps(steps, flags);
    const removedSteps = removedByArea.get(room.areaId) ?? [];
    const applicableCatalog = catalogAll.filter((c) => {
      const types = (c.applies_to_area_types as string[] | null) ?? null;
      return types === null || types.includes(room.areaType);
    });
    const roomAddableCatalog = addableCatalog(
      applicableCatalog.map((c) => ({ code: c.code, name: c.name })),
      steps.map((s) => s.step_code),
    );
    result.set(room.areaId, { steps, flags, addableCatalog: roomAddableCatalog, removedSteps, grouped, active });
  }
  return result;
}
