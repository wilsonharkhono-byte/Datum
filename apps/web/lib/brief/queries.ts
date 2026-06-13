import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import {
  findCascadeRisks,
  findExpiringQuotes,
  type GateRisk,
  type ScheduleCell,
  type QuoteEvent,
} from "@/lib/brief/bottlenecks";
import { ACTOR_LABELS } from "@/lib/cards/labels";
import { compareEventTime, type OrderableEvent } from "@/lib/cards/event-order";

export type BriefItem = {
  id: string;
  projectCode: string;
  cardTitle: string;
  cardHref: string;
  detail: string;
  meta: string; // e.g., "2 hari" or "PT Galleria · Rp 2.4 jt"
};

export type BriefData = {
  pendingDrafts:   { count: number; items: BriefItem[] };
  blockers:        { count: number; items: BriefItem[] };
  defects:         { count: number; items: BriefItem[] };
  decisionsNeeded: { count: number; items: BriefItem[] };
  awaitingClient:  { count: number; items: BriefItem[] };
  expiringQuotes:  { count: number; items: BriefItem[] };
  gateRisks:       GateRisk[];
  staleByProject:  { projectCode: string; projectName: string; staleCount: number }[];
};

const TOP_N = 5;

function daysAgo(iso: string): number {
  // No Date.now() at build time per workflow rules — but server actions can use it
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function ageMeta(iso: string): string {
  const d = daysAgo(iso);
  if (d <= 0) return "hari ini";
  if (d === 1) return "1 hari";
  if (d < 30) return `${d} hari`;
  const months = Math.floor(d / 30);
  return `${months} bulan`;
}

type CardRef = {
  id: string; slug: string; title: string;
  projects: { project_code: string; project_name: string } | null;
};

export async function getBriefData(supabase: SupabaseClient<Database>): Promise<BriefData> {
  const thirtyAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    { data: draftRows, count: draftCount },
    { data: blockedRaw },
    { data: defectEvs, count: defectCount },
    { data: crEvs, count: crCount },
    { data: decEvs, count: decCount },
    { data: vendorEvs },
    { data: gateRows },
  ] = await Promise.all([
    // 1. Pending drafts (card_event drafts)
    supabase
      .from("data_drafts")
      .select(`
        id, created_at, proposed_payload, original_input_text,
        projects:project_id (project_code, project_name)
      `, { count: "exact" })
      .eq("status", "draft")
      .eq("draft_type", "card_event")
      .order("created_at", { ascending: true })
      .limit(TOP_N),
    // 2. Live blockers: work events with status=blocked not superseded by a
    //    later non-blocked work event on the same card (append-only log).
    // TODO(scale): limit(100) oldest-first truncates count and can drop newest blockers past 100 rows; revisit with a server-side open-blocker view.
    supabase
      .from("card_events")
      .select(`
        id, payload, occurred_at, created_at, card_id,
        cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
      `)
      .eq("event_kind", "work")
      .contains("payload", { status: "blocked" })
      .order("occurred_at", { ascending: true })
      .limit(100),
    // 3. Defects (last 30 days; work events flagged issue=defect)
    supabase
      .from("card_events")
      .select(`
        id, payload, occurred_at,
        cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
      `, { count: "exact" })
      .eq("event_kind", "work")
      .contains("payload", { issue: "defect" })
      .gte("occurred_at", thirtyAgo)
      .order("occurred_at", { ascending: false })
      .limit(TOP_N),
    // 4. Awaiting client (open client_request events, oldest first)
    supabase
      .from("card_events")
      .select(`
        id, payload, occurred_at,
        cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
      `, { count: "exact" })
      .eq("event_kind", "client_request")
      .contains("payload", { status: "open" })
      .order("occurred_at", { ascending: true })
      .limit(TOP_N),
    // 5. Decisions needed — the core coordination list, actor in meta
    supabase
      .from("card_events")
      .select(`
        id, payload, occurred_at,
        cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
      `, { count: "exact" })
      .eq("event_kind", "decision")
      .contains("payload", { status: "needs_decision" })
      .order("occurred_at", { ascending: true })
      .limit(TOP_N),
    // 6. Expiring vendor quotes (cost-visible staff only — RLS hides these
    //    events from everyone else, so the section degrades to empty).
    supabase
      .from("card_events")
      .select(`
        id, card_id, payload, occurred_at,
        cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
      `)
      .eq("event_kind", "vendor")
      .limit(500),
    // 7+8. Gate cells: scheduled windows (cascade risks) and stale rows
    supabase
      .from("area_gate_status")
      .select(`
        area_id, gate_code, status, target_start_date, target_end_date, project_id, stale,
        areas:area_id (area_name),
        projects:project_id (project_code, project_name)
      `)
      .or("target_start_date.not.is.null,stale.eq.true"),
  ]);

  const pendingDrafts = {
    count: draftCount ?? 0,
    items: (draftRows ?? []).map((d) => {
      const proj = (d as { projects: { project_code: string; project_name: string } | null }).projects;
      const p = d.proposed_payload as { kind?: string; card_id?: string; payload?: Record<string, unknown> };
      return {
        id: `draft_${d.id}`,
        projectCode: proj?.project_code ?? "?",
        cardTitle: typeof p.kind === "string" ? p.kind : "draft",
        cardHref: "/review",
        detail: (d.original_input_text ?? "").slice(0, 120) || (p.payload ? JSON.stringify(p.payload).slice(0, 120) : ""),
        meta: ageMeta(d.created_at),
      };
    }),
  };

  const blockedCardIds = [...new Set((blockedRaw ?? []).map((e) => e.card_id))];
  // Latest non-blocked work EVENT per card, chosen by the canonical total
  // order (occurred_at, created_at, id) — same-day ties must resolve the
  // same way here as on the board and in the gate rules.
  const lastNonBlockedByCard = new Map<string, OrderableEvent>();
  if (blockedCardIds.length > 0) {
    // TODO(scale): relies on PostgREST's implicit 1000-row cap; add occurred_at lower bound if work-event volume grows.
    const { data: workEvs } = await supabase
      .from("card_events")
      .select("id, card_id, occurred_at, created_at, payload")
      .eq("event_kind", "work")
      .in("card_id", blockedCardIds);
    for (const w of workEvs ?? []) {
      const status = (w.payload as { status?: string } | null)?.status;
      if (status === "blocked") continue;
      const prev = lastNonBlockedByCard.get(w.card_id);
      if (!prev || compareEventTime(prev, w) < 0) lastNonBlockedByCard.set(w.card_id, w);
    }
  }
  const liveBlockers = (blockedRaw ?? []).filter((e) => {
    const cleared = lastNonBlockedByCard.get(e.card_id);
    return !cleared || compareEventTime(e, cleared) > 0;
  });

  const blockers = {
    count: liveBlockers.length,
    items: liveBlockers.slice(0, TOP_N).map((e) => {
      const c = (e as { cards: CardRef | null }).cards;
      const p = e.payload as { blocked_on?: string; description?: string };
      return {
        id: `blk_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: p.blocked_on ?? p.description ?? "",
        meta: ageMeta(e.occurred_at ?? ""),
      };
    }),
  };

  const defects = {
    count: defectCount ?? 0,
    items: (defectEvs ?? []).map((e) => {
      const c = (e as { cards: CardRef | null }).cards;
      const p = e.payload as { description?: string; severity?: string };
      return {
        id: `def_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: `${p.severity ?? "?"} · ${p.description ?? ""}`,
        meta: ageMeta(e.occurred_at ?? ""),
      };
    }),
  };

  const awaitingClient = {
    count: crCount ?? 0,
    items: (crEvs ?? []).map((e) => {
      const c = (e as { cards: CardRef | null }).cards;
      const p = e.payload as { request_text?: string; requested_by?: string; awaiting?: string };
      return {
        id: `cr_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: p.request_text ?? "",
        meta: `${ageMeta(e.occurred_at ?? "")}${p.requested_by ? ` · ${p.requested_by}` : ""}`,
      };
    }),
  };

  const decisionsNeeded = {
    count: decCount ?? 0,
    items: (decEvs ?? []).map((e) => {
      const c = (e as { cards: CardRef | null }).cards;
      const p = e.payload as { topic?: string; proposed_spec?: string; awaiting?: string };
      const actor = p.awaiting ? ACTOR_LABELS[p.awaiting] ?? p.awaiting : null;
      return {
        id: `dec_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: `${p.topic ?? ""}${p.proposed_spec ? ` — ${p.proposed_spec}` : ""}`,
        meta: `${ageMeta(e.occurred_at ?? "")}${actor ? ` · menunggu ${actor}` : ""}`,
      };
    }),
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const expiring = findExpiringQuotes((vendorEvs ?? []) as unknown as QuoteEvent[], todayIso);
  const expiringQuotes = {
    count: expiring.length,
    items: expiring.slice(0, TOP_N).map((e) => {
      const c = ((e as unknown) as { cards: CardRef | null }).cards;
      return {
        id: `quo_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: `${e.payload.vendor_name ?? "vendor"} — berlaku sampai ${e.payload.expires_at}`,
        meta: ageMeta(e.occurred_at ?? ""),
      };
    }),
  };

  // 7. Gates at cascade risk: window started but predecessor gate not ready
  const cellRows = (gateRows ?? []).filter((r) => r.target_start_date !== null);
  const scheduleCells: ScheduleCell[] = cellRows.map((r) => {
    const area = (r as { areas: { area_name: string } | null }).areas;
    const proj = (r as { projects: { project_code: string; project_name: string } | null }).projects;
    return {
      project_code: proj?.project_code ?? "?",
      project_name: proj?.project_name ?? "?",
      area_id: r.area_id,
      area_name: area?.area_name ?? r.area_id,
      gate_code: r.gate_code,
      status: r.status,
      target_start_date: r.target_start_date,
      target_end_date: r.target_end_date,
    };
  });
  const gateRisks = findCascadeRisks(scheduleCells, todayIso);

  // 8. Stale by project
  const staleRows = (gateRows ?? []).filter((r) => r.stale === true);

  const byProject = new Map<string, { code: string; name: string; n: number }>();
  for (const r of staleRows) {
    const proj = (r as { projects: { project_code: string; project_name: string } | null }).projects;
    if (!proj) continue;
    const cur = byProject.get(r.project_id) ?? { code: proj.project_code, name: proj.project_name, n: 0 };
    cur.n += 1;
    byProject.set(r.project_id, cur);
  }

  const staleByProject = [...byProject.values()]
    .map((v) => ({ projectCode: v.code, projectName: v.name, staleCount: v.n }))
    .sort((a, b) => b.staleCount - a.staleCount);

  return { pendingDrafts, blockers, defects, decisionsNeeded, awaitingClient, expiringQuotes, gateRisks, staleByProject };
}
