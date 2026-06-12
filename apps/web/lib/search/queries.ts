import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type SearchHit = {
  id: string;
  kind: "card" | "event" | "comment" | "project";
  projectCode: string;
  cardSlug: string;
  cardTitle: string;
  snippet: string;
  href: string;
  occurredAt: string;
};

type CardJoin = {
  slug: string;
  title: string;
  projects: { project_code: string } | null;
};

const PER_GROUP = 25;

export async function searchAll(
  supabase: SupabaseClient<Database>,
  q: string,
): Promise<{ projects: SearchHit[]; cards: SearchHit[]; events: SearchHit[]; comments: SearchHit[] }> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { projects: [], cards: [], events: [], comments: [] };
  }
  const pattern = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  // Projects: name / client / site address
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, project_code, project_name, client_name, location")
    .or(
      `project_name.ilike.${pattern},client_name.ilike.${pattern},site_address.ilike.${pattern}`,
    )
    .limit(PER_GROUP);

  const projects: SearchHit[] = (projectRows ?? []).map((p) => ({
    id: `p_${p.id}`,
    kind: "project" as const,
    projectCode: p.project_code,
    cardSlug: "",
    cardTitle: `${p.project_code} · ${p.project_name}`,
    snippet: [p.client_name ? `Client: ${p.client_name}` : null, p.location].filter(Boolean).join(" · "),
    href: `/project/${p.project_code}`,
    occurredAt: "",
  }));

  // Cards: title OR current_summary
  const { data: cardRows } = await supabase
    .from("cards")
    .select(`id, slug, title, current_summary, created_at, projects:project_id (project_code)`)
    .or(`title.ilike.${pattern},current_summary.ilike.${pattern}`)
    .limit(PER_GROUP);

  const cards: SearchHit[] = (cardRows ?? []).map((c) => {
    const proj = (c as { projects: { project_code: string } | null }).projects;
    const code = proj?.project_code ?? "?";
    return {
      id: `c_${c.id}`,
      kind: "card",
      projectCode: code,
      cardSlug: c.slug,
      cardTitle: c.title,
      snippet: highlight(c.title + (c.current_summary ? " — " + c.current_summary : ""), trimmed),
      href: `/project/${code}/cards/${c.slug}`,
      occurredAt: c.created_at,
    };
  });

  // Events: payload cast to text (jsonb::text supports ilike)
  // Supabase doesn't directly let us .ilike on a jsonb cast; use the rpc-like trick: filter via .or() with payload::text
  // PostgREST supports the .ilike filter on jsonb-as-text using "payload->>somefield" only for top-level keys.
  // Workaround: use the all() RPC or the supabase REST text search via .textSearch.
  // Simplest acceptable: query by joining and filtering with .ilike on a TEXT column we already have.
  // We'll search a few common text-bearing fields by extracting them via PostgREST's ->> operator.
  // Actually simplest: do 3 separate small queries on payload->>'body', payload->>'description', payload->>'topic'.
  const eventFields = ["body", "description", "topic", "request_text", "what", "notes", "title", "caption"];
  const eventResults: unknown[] = [];
  for (const f of eventFields) {
    const { data } = await supabase
      .from("card_events")
      .select(`id, event_kind, payload, occurred_at, cards:card_id (slug, title, projects:project_id (project_code))`)
      .ilike(`payload->>${f}`, pattern)
      .limit(PER_GROUP);
    if (data) eventResults.push(...data);
  }
  // Dedup by id, sort, cap
  const seen = new Set<string>();
  const eventHits: SearchHit[] = [];
  for (const e of eventResults) {
    const row = e as { id: string; event_kind: string; payload: unknown; occurred_at: string; cards: CardJoin | null };
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const c = row.cards;
    if (!c?.projects) continue;
    const code = c.projects.project_code;
    const payloadStr = JSON.stringify(row.payload);
    eventHits.push({
      id: `e_${row.id}`,
      kind: "event",
      projectCode: code,
      cardSlug: c.slug,
      cardTitle: c.title,
      snippet: `[${row.event_kind}] ${highlight(payloadStr, trimmed).slice(0, 180)}`,
      href: `/project/${code}/cards/${c.slug}`,
      occurredAt: row.occurred_at,
    });
    if (eventHits.length >= PER_GROUP) break;
  }

  // Comments: body ilike, exclude soft-deleted
  const { data: commentRows } = await supabase
    .from("card_comments")
    .select(`id, body, created_at, cards:card_id (slug, title, projects:project_id (project_code))`)
    .ilike("body", pattern)
    .is("deleted_at", null)
    .limit(PER_GROUP);

  const comments: SearchHit[] = (commentRows ?? []).map((co) => {
    const c = (co as unknown as { cards: CardJoin | null }).cards;
    const code = c?.projects?.project_code ?? "?";
    return {
      id: `co_${co.id}`,
      kind: "comment",
      projectCode: code,
      cardSlug: c?.slug ?? "",
      cardTitle: c?.title ?? "",
      snippet: highlight(co.body, trimmed),
      href: c?.slug ? `/project/${code}/cards/${c.slug}` : "#",
      occurredAt: co.created_at,
    };
  });

  return { projects, cards, events: eventHits, comments };
}

function highlight(text: string, q: string): string {
  // Return a substring window around the first match (server-side only; client can't restyle)
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, 180);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + q.length + 100);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
