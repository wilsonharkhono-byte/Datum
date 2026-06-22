import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type ActivityKind = "event" | "comment" | "card";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  occurredAt: string;
  projectCode: string;
  projectName: string;
  cardId: string;
  cardSlug: string;
  cardTitle: string;
  actor: string | null;
  detail: string;
  eventKind?: string;
};

const LIMIT = 50;

export async function getRecentActivity(
  supabase: SupabaseClient<Database>,
): Promise<ActivityItem[]> {
  // Three parallel queries, then merge + sort + cap.
  const [evRes, coRes, caRes] = await Promise.all([
    supabase
      .from("card_events")
      .select(`
        id, event_kind, payload, occurred_at, created_at,
        cards:card_id (id, slug, title, projects:project_id (project_code, project_name)),
        staff:logged_by_staff_id (full_name)
      `)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("card_comments")
      .select(`
        id, body, created_at,
        cards:card_id (id, slug, title, projects:project_id (project_code, project_name)),
        staff:created_by_staff_id (full_name)
      `)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("cards")
      .select(`
        id, slug, title, created_at,
        projects:project_id (project_code, project_name),
        staff:created_by_staff_id (full_name)
      `)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);

  const items: ActivityItem[] = [];

  for (const ev of evRes.data ?? []) {
    const c = (ev as { cards: { id: string; slug: string; title: string; projects: { project_code: string; project_name: string } | null } | null }).cards;
    if (!c?.projects) continue;
    const staff = (ev as { staff: { full_name: string | null } | null }).staff;
    items.push({
      id: `ev_${ev.id}`,
      kind: "event",
      occurredAt: (ev.occurred_at ?? ev.created_at) as string,
      projectCode: c.projects.project_code,
      projectName: c.projects.project_name,
      cardId: c.id,
      cardSlug: c.slug,
      cardTitle: c.title,
      actor: staff?.full_name ?? null,
      detail: summarizeEvent(ev.event_kind as string, ev.payload as Record<string, unknown>),
      eventKind: ev.event_kind as string,
    });
  }

  for (const co of coRes.data ?? []) {
    const c = (co as { cards: { id: string; slug: string; title: string; projects: { project_code: string; project_name: string } | null } | null }).cards;
    if (!c?.projects) continue;
    const staff = (co as { staff: { full_name: string | null } | null }).staff;
    items.push({
      id: `co_${co.id}`,
      kind: "comment",
      occurredAt: co.created_at,
      projectCode: c.projects.project_code,
      projectName: c.projects.project_name,
      cardId: c.id,
      cardSlug: c.slug,
      cardTitle: c.title,
      actor: staff?.full_name ?? null,
      detail: co.body.length > 120 ? co.body.slice(0, 120) + "…" : co.body,
    });
  }

  for (const ca of caRes.data ?? []) {
    const proj = (ca as { projects: { project_code: string; project_name: string } | null }).projects;
    if (!proj) continue;
    const staff = (ca as { staff: { full_name: string | null } | null }).staff;
    items.push({
      id: `ca_${ca.id}`,
      kind: "card",
      occurredAt: ca.created_at,
      projectCode: proj.project_code,
      projectName: proj.project_name,
      cardId: ca.id,
      cardSlug: ca.slug,
      cardTitle: ca.title,
      actor: staff?.full_name ?? null,
      detail: `Kartu baru: ${ca.title}`,
    });
  }

  // Sort desc by occurredAt, cap to LIMIT
  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return items.slice(0, LIMIT);
}

/**
 * Pure summariser for a card event payload. Returns a human-readable detail
 * string suitable for the activity feed.
 */
export function summarizeEvent(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "decision":       return `${payload.topic ?? ""} — ${payload.proposed_spec ?? payload.current_spec ?? ""}`.trim();
    case "drawing":        return String(payload.description ?? payload.drawing_code ?? "");
    case "survey":         return [payload.vendor_name, payload.location].filter(Boolean).join(" · ") || "survei";
    case "vendor_quote":   return `${payload.vendor_name ?? "vendor"} · Rp ${typeof payload.amount === "number" ? payload.amount.toLocaleString("id-ID") : payload.amount}`;
    case "vendor_pick":    return String(payload.vendor_name ?? "vendor dipilih");
    case "material":       return `${payload.item ?? "item"} — ${payload.status ?? ""}`;
    case "worker_assigned":return `${payload.worker_name ?? "tukang"}${payload.scope ? ` — ${payload.scope}` : ""}`;
    case "progress":       return `${payload.status ?? "progres"}${payload.percent_complete != null ? ` (${payload.percent_complete}%)` : ""}`;
    case "defect":         return `${payload.severity ?? ""} · ${payload.description ?? ""}`;
    case "photo":          return String(payload.caption ?? "(foto)");
    case "document":       return String(payload.title ?? "dokumen");
    case "client_request": return String(payload.request_text ?? "");
    case "note":           return String(payload.body ?? "");
    case "pending":        return String(payload.what ?? "");
    default:               return JSON.stringify(payload).slice(0, 100);
  }
}
