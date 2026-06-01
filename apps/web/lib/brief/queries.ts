import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type BriefItem = {
  id: string;
  projectCode: string;
  cardTitle: string;
  cardHref: string;
  detail: string;
  meta: string; // e.g., "2 hari" or "PT Galleria · Rp 2.4 jt"
};

export type BriefData = {
  pendingDrafts:    { count: number; items: BriefItem[] };
  openPendings:     { count: number; items: BriefItem[] };
  defects:          { count: number; items: BriefItem[] };
  awaitingClient:   { count: number; items: BriefItem[] };
  staleByProject:   { projectCode: string; projectName: string; staleCount: number }[];
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
  // 1. Pending drafts (card_event drafts)
  const { data: draftRows, count: draftCount } = await supabase
    .from("data_drafts")
    .select(`
      id, created_at, proposed_payload, original_input_text,
      projects:project_id (project_code, project_name)
    `, { count: "exact" })
    .eq("status", "draft")
    .eq("draft_type", "card_event")
    .order("created_at", { ascending: true })
    .limit(TOP_N);

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

  // 2. Open pending events (event_kind='pending', no subsequent progress event on same card after it)
  const { data: pendingEvs, count: pendingCount } = await supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `, { count: "exact" })
    .eq("event_kind", "pending")
    .order("occurred_at", { ascending: true })
    .limit(TOP_N);

  const openPendings = {
    count: pendingCount ?? 0,
    items: (pendingEvs ?? []).map((e) => {
      const c = (e as { cards: CardRef | null }).cards;
      const p = e.payload as { what?: string };
      return {
        id: `pend_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: p.what ?? "",
        meta: ageMeta(e.occurred_at ?? ""),
      };
    }),
  };

  // 3. Defects (last 30 days, high or medium)
  const thirtyAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: defectEvs, count: defectCount } = await supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `, { count: "exact" })
    .eq("event_kind", "defect")
    .gte("occurred_at", thirtyAgo)
    .order("occurred_at", { ascending: false })
    .limit(TOP_N);

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

  // 4. Awaiting client (client_request events; heuristic: any in last 60 days)
  const sixtyAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: crEvs, count: crCount } = await supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `, { count: "exact" })
    .eq("event_kind", "client_request")
    .gte("occurred_at", sixtyAgo)
    .order("occurred_at", { ascending: false })
    .limit(TOP_N);

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

  // 5. Stale by project
  const { data: staleRows } = await supabase
    .from("area_gate_status")
    .select(`
      project_id,
      projects:project_id (project_code, project_name)
    `)
    .eq("stale", true);

  const byProject = new Map<string, { code: string; name: string; n: number }>();
  for (const r of staleRows ?? []) {
    const proj = (r as { projects: { project_code: string; project_name: string } | null }).projects;
    if (!proj) continue;
    const cur = byProject.get(r.project_id) ?? { code: proj.project_code, name: proj.project_name, n: 0 };
    cur.n += 1;
    byProject.set(r.project_id, cur);
  }

  const staleByProject = [...byProject.values()]
    .map((v) => ({ projectCode: v.code, projectName: v.name, staleCount: v.n }))
    .sort((a, b) => b.staleCount - a.staleCount);

  return { pendingDrafts, openPendings, defects, awaitingClient, staleByProject };
}
