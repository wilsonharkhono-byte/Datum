import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { must } from "../db/must";

export type SearchHit = {
  id: string;
  kind: "card" | "event" | "comment" | "project" | "development" | "attachment";
  projectCode: string;
  cardSlug: string;
  cardTitle: string;
  snippet: string;
  href: string;
  occurredAt: string;
};

export type SearchResults = {
  developments: SearchHit[];
  projects: SearchHit[];
  cards: SearchHit[];
  events: SearchHit[];
  comments: SearchHit[];
  attachments: SearchHit[];
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
): Promise<SearchResults> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { developments: [], projects: [], cards: [], events: [], comments: [], attachments: [] };
  }
  const pattern = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  // A failed query group must NOT render as "Tidak ada hasil".
  const { data: devRows } = must(
    await supabase
      .from("developments")
      .select("id, name, area_label")
      .ilike("name", pattern)
      .limit(PER_GROUP),
    "search.developments",
  );

  const developments: SearchHit[] = (devRows ?? []).map((d) => ({
    id: `d_${d.id}`,
    kind: "development" as const,
    projectCode: "",
    cardSlug: "",
    cardTitle: d.name,
    snippet: d.area_label ?? "",
    href: `/?dev=${d.id}`,
    occurredAt: "",
  }));

  // Projects: name / client / site address
  // KNOWN BUG (tracked): the .or() filter includes `site_address.ilike.${pattern}` but the
  // select/snippet uses `location` instead of `site_address`. Searching by location text
  // matches nothing via site_address. Preserved verbatim for web/mobile parity — to be
  // fixed cross-app in a dedicated bug fix later.
  const { data: projectRows } = must(
    await supabase
      .from("projects")
      .select("id, project_code, project_name, client_name, location")
      .or(
        `project_name.ilike.${pattern},client_name.ilike.${pattern},site_address.ilike.${pattern}`,
      )
      .limit(PER_GROUP),
    "search.projects",
  );

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
  const { data: cardRows } = must(
    await supabase
      .from("cards")
      .select(`id, slug, title, current_summary, created_at, projects:project_id (project_code)`)
      .or(`title.ilike.${pattern},current_summary.ilike.${pattern}`)
      .limit(PER_GROUP),
    "search.cards",
  );

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

  // Events: sweep common payload text fields in a single .or() query
  const eventFields = ["body", "description", "topic", "request_text", "what", "notes", "title", "caption"];
  const orTerm = trimmed.replace(/[,()]/g, "").replace(/[%_]/g, (m) => `\\${m}`);
  const orPattern = `*${orTerm}*`;
  const { data: eventRows } = must(
    await supabase
      .from("card_events")
      .select(`id, event_kind, payload, occurred_at, cards:card_id (slug, title, projects:project_id (project_code))`)
      .or(eventFields.map((f) => `payload->>${f}.ilike.${orPattern}`).join(","))
      .limit(PER_GROUP * 2),
    "search.events",
  );
  // Dedup by id, sort, cap
  const seen = new Set<string>();
  const eventHits: SearchHit[] = [];
  for (const e of eventRows ?? []) {
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
  const { data: commentRows } = must(
    await supabase
      .from("card_comments")
      .select(`id, body, created_at, cards:card_id (slug, title, projects:project_id (project_code))`)
      .ilike("body", pattern)
      .is("deleted_at", null)
      .limit(PER_GROUP),
    "search.comments",
  );

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

  // Attachments: AI caption ilike. Joined event→card→project; RLS-scoped so
  // cost-sensitive captions never reach non-cost roles.
  const { data: attachmentRows } = must(
    await supabase
      .from("card_attachments")
      .select(
        `id, ai_caption, mime_type, card_events:card_event_id ( cards:card_id ( slug, title, projects:project_id ( project_code ) ) )`,
      )
      .ilike("ai_caption", pattern)
      .limit(PER_GROUP),
    "search.attachments",
  );

  const attachments: SearchHit[] = [];
  for (const a of attachmentRows ?? []) {
    const row = a as {
      id: string;
      ai_caption: string | null;
      card_events: { cards: CardJoin | null } | null;
    };
    const c = row.card_events?.cards;
    const code = c?.projects?.project_code;
    if (!c || !code || !row.ai_caption) continue;
    attachments.push({
      id: `a_${row.id}`,
      kind: "attachment",
      projectCode: code,
      cardSlug: c.slug,
      cardTitle: c.title,
      snippet: highlight(row.ai_caption, trimmed),
      href: `/project/${code}/cards/${c.slug}`,
      occurredAt: "",
    });
  }

  return { developments, projects, cards, events: eventHits, comments, attachments };
}

function highlight(text: string, q: string): string {
  // Return a substring window around the first match (server-side only; client can't restyle)
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, 180);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + q.length + 100);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
