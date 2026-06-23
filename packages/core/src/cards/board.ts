import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Project, Topic, Card } from "@datum/db";
import { computeCardLabels, type CardWithLabels, type LabelEvent } from "./labels";
import { computeCardDeadlines, type CardDeadline, type DeadlineCell } from "../gates/board-deadlines";

export type BoardColumn = { topic: Topic; cards: CardWithLabels[] };
export type Board = { project: Project; columns: BoardColumn[] };

export type BoardBundle = {
  project: Project;
  topics: Pick<Topic, "id" | "code" | "name" | "sort_order">[];
  cards: Pick<Card, "id" | "slug" | "title" | "topic_id" | "status" | "last_event_at" | "current_summary" | "properties">[];
  loop_events: { id: string; card_id: string; event_kind: string; payload: Record<string, unknown> | null; occurred_at: string; created_at: string }[];
  card_areas: { card_id: string; area_id: string }[];
  gate_status: DeadlineCell[];
};

export async function getBoardForProject(
  supabase: SupabaseClient<Database>,
  projectSlug: string,
): Promise<Board> {
  // Direct per-table reads (each query applies RLS with the caller's auth — the
  // same path getCurrentStaff and the rest of the app use). The get_board_bundle
  // RPC was reverted: bundling every read into one function failed for
  // authenticated users (evaluating the cards-layer RLS for all sub-selects
  // inside one function erred, where the multi-query path tolerates a failing
  // open-loop / areas / gate sub-select). mapBoardBundle still does all the
  // label/deadline/grouping logic.
  const slugUpper = projectSlug.toUpperCase();
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("*")
    .eq("project_code", slugUpper)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project) throw new Error(`Project not found: ${projectSlug}`);

  const [topicsRes, cardsRes, loopEventsRes] = await Promise.all([
    supabase
      .from("topics")
      .select("id, code, name, sort_order")
      .eq("project_id", project.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("cards")
      .select("id, slug, title, topic_id, status, last_event_at, current_summary, properties")
      .eq("project_id", project.id)
      .order("last_event_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("card_events")
      .select("id, card_id, event_kind, payload, occurred_at, created_at")
      .eq("project_id", project.id)
      .in("event_kind", ["decision", "client_request", "work"]),
  ]);
  if (topicsRes.error) throw topicsRes.error;
  if (cardsRes.error) throw cardsRes.error;
  if (loopEventsRes.error) {
    console.warn(
      "[getBoardForProject] open-loop events query failed — labels will be empty:",
      loopEventsRes.error.message,
    );
  }

  const cards = (cardsRes.data ?? []) as unknown as BoardBundle["cards"];
  let cardAreas: BoardBundle["card_areas"] = [];
  let gateStatus: BoardBundle["gate_status"] = [];
  if (cards.length > 0) {
    const cardIds = cards.map((c) => c.id);
    const [linksRes, cellsRes] = await Promise.all([
      supabase.from("card_areas").select("card_id, area_id").in("card_id", cardIds),
      supabase
        .from("area_gate_status")
        .select("area_id, gate_code, status, target_start_date, target_end_date")
        .eq("project_id", project.id)
        .in("status", ["not_started", "in_progress"])
        .not("target_start_date", "is", null),
    ]);
    cardAreas = (linksRes.data ?? []) as unknown as BoardBundle["card_areas"];
    gateStatus = (cellsRes.data ?? []) as unknown as BoardBundle["gate_status"];
  }

  return mapBoardBundle(
    {
      project: project as Project,
      topics: (topicsRes.data ?? []) as unknown as BoardBundle["topics"],
      cards,
      loop_events: (loopEventsRes.data ?? []) as unknown as BoardBundle["loop_events"],
      card_areas: cardAreas,
      gate_status: gateStatus,
    },
    new Date().toISOString().slice(0, 10),
  );
}

/** Pure: turn a get_board_bundle payload into the Board the UI renders. Holds all
    label/deadline/grouping logic so it stays in one tested place. */
export function mapBoardBundle(bundle: BoardBundle, today: string): Board {
  const eventsByCard = new Map<string, LabelEvent[]>();
  for (const ev of bundle.loop_events) {
    const arr = eventsByCard.get(ev.card_id) ?? [];
    arr.push({
      event_kind: ev.event_kind,
      payload: ev.payload,
      occurred_at: ev.occurred_at,
      created_at: ev.created_at,
      id: ev.id,
    });
    eventsByCard.set(ev.card_id, arr);
  }

  const cards = (bundle.cards as unknown) as Card[];
  const deadlines = cards.length
    ? computeCardDeadlines(bundle.card_areas, bundle.gate_status, today)
    : new Map<string, CardDeadline>();

  const cardsByTopic = new Map<string, CardWithLabels[]>();
  for (const c of cards) {
    const labels = computeCardLabels(c, eventsByCard.get(c.id) ?? []);
    const withLabels: CardWithLabels = { ...c, labels, deadline: deadlines.get(c.id) ?? null };
    const arr = cardsByTopic.get(c.topic_id) ?? [];
    arr.push(withLabels);
    cardsByTopic.set(c.topic_id, arr);
  }

  const columns: BoardColumn[] = ((bundle.topics as unknown) as Topic[]).map((t) => ({
    topic: t,
    cards: cardsByTopic.get(t.id) ?? [],
  }));

  return { project: bundle.project, columns };
}

export async function getProjectTopics(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<Topic[]> {
  const { data, error } = await supabase
    .from("topics")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
