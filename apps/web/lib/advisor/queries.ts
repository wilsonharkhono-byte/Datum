/**
 * "Hari Ini" advisor — data assembly. One function, concurrent queries over
 * EXISTING data only (no new tables): gate deadlines, live blockers, open
 * decisions, open client requests, expiring quotes, cascade risks, stale
 * cards. Mapping → AdvisorSignal happens here; scoring lives in rank.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import {
  findCascadeRisks,
  findExpiringQuotes,
  type QuoteEvent,
  type ScheduleCell,
} from "@/lib/brief/bottlenecks";
import { compareEventTime, type OrderableEvent } from "@/lib/cards/event-order";
import { ACTOR_LABELS } from "@/lib/cards/labels";
import { gateShortName } from "@/lib/gates/labels";
import { ageLabelFor, dueLabelFor, rankAdvisorItems } from "@/lib/advisor/rank";
import type { AdvisorGateCell, AdvisorItem, AdvisorSignal } from "@/lib/advisor/types";

const STALE_DAYS = 30;
const GATE_SOON_WINDOW_DAYS = 7;
/** Gate statuses that still need work — mirrors SATISFIED in bottlenecks.ts. */
const UNSATISFIED_GATE_STATUSES = ["not_started", "in_progress", "blocked"] as const;
/** Per-source row caps so one noisy source can't crowd out the Promise.all. */
const PER_SOURCE_CAP = 25;

export type GetAdvisorOpts = {
  /** When given, every query is scoped to this project; otherwise cross-project. */
  projectId?: string;
  /** Injected for testability — never call Date.now() below this point. */
  now: Date;
  limit?: number;
};

export type AdvisorData = {
  items: AdvisorItem[];
  /** Unsatisfied gate cells sorted by nearest target_end_date (incl. overdue). */
  upcomingGateCells: AdvisorGateCell[];
};

type ProjRef = { project_code: string; project_name: string } | null;
type CardRef = { id: string; slug: string; title: string; projects: ProjRef } | null;

const cardHref = (c: CardRef): string =>
  c?.projects ? `/project/${c.projects.project_code}/cards/${c.slug}` : "#";

export async function getAdvisorData(
  supabase: SupabaseClient<Database>,
  opts: GetAdvisorOpts,
): Promise<AdvisorData> {
  const { projectId, now } = opts;
  const todayIso = now.toISOString().slice(0, 10);
  const staleBefore = new Date(now.getTime() - STALE_DAYS * 86_400_000).toISOString();

  // Build each query, optionally project-scoped, then run them CONCURRENTLY.
  let gateQ = supabase
    .from("area_gate_status")
    .select(`
      area_id, gate_code, status, target_start_date, target_end_date, project_id,
      areas:area_id (area_name),
      projects:project_id (project_code, project_name)
    `)
    .not("target_start_date", "is", null);
  if (projectId) gateQ = gateQ.eq("project_id", projectId);

  // Blocked work events (append-only log: superseded ones filtered below).
  let blockedQ = supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at, created_at, card_id,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `)
    .eq("event_kind", "work")
    .contains("payload", { status: "blocked" })
    .order("occurred_at", { ascending: true })
    .limit(100);
  if (projectId) blockedQ = blockedQ.eq("project_id", projectId);

  let decisionQ = supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `)
    .eq("event_kind", "decision")
    .contains("payload", { status: "needs_decision" })
    .order("occurred_at", { ascending: true })
    .limit(PER_SOURCE_CAP);
  if (projectId) decisionQ = decisionQ.eq("project_id", projectId);

  let requestQ = supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `)
    .eq("event_kind", "client_request")
    .contains("payload", { status: "open" })
    .order("occurred_at", { ascending: true })
    .limit(PER_SOURCE_CAP);
  if (projectId) requestQ = requestQ.eq("project_id", projectId);

  // Vendor events: quote expiry pairs with pick/contract on the same card, so
  // pull the kind wholesale (RLS hides these from non-cost-visible staff —
  // the source then degrades to empty, same as the brief).
  let vendorQ = supabase
    .from("card_events")
    .select(`
      id, card_id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `)
    .eq("event_kind", "vendor")
    .limit(500);
  if (projectId) vendorQ = vendorQ.eq("project_id", projectId);

  let staleQ = supabase
    .from("cards")
    .select(`
      id, slug, title, last_event_at,
      projects:project_id (project_code, project_name)
    `)
    .eq("status", "active")
    .lt("last_event_at", staleBefore)
    .order("last_event_at", { ascending: true })
    .limit(PER_SOURCE_CAP);
  if (projectId) staleQ = staleQ.eq("project_id", projectId);

  const [
    { data: gateRows },
    { data: blockedRaw },
    { data: decEvs },
    { data: crEvs },
    { data: vendorEvs },
    { data: staleCards },
  ] = await Promise.all([gateQ, blockedQ, decisionQ, requestQ, vendorQ, staleQ]);

  const signals: AdvisorSignal[] = [];

  // ── Gates: overdue, due ≤7d, and cascade risks — all from one query ────────
  const soonHorizon = new Date(now.getTime() + GATE_SOON_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const scheduleCells: ScheduleCell[] = (gateRows ?? []).map((r) => {
    const area = (r as { areas: { area_name: string } | null }).areas;
    const proj = (r as { projects: ProjRef }).projects;
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

  const unsatisfied = scheduleCells.filter(
    (c) =>
      (UNSATISFIED_GATE_STATUSES as readonly string[]).includes(c.status) &&
      c.target_end_date != null,
  );
  const upcomingGateCells: AdvisorGateCell[] = unsatisfied
    .slice()
    .sort((a, b) => a.target_end_date!.localeCompare(b.target_end_date!))
    .map((c) => ({
      areaName: c.area_name,
      gateCode: c.gate_code,
      status: c.status,
      targetEndDate: c.target_end_date!,
    }));

  for (const c of unsatisfied) {
    const end = c.target_end_date!;
    const label = dueLabelFor(end, now);
    if (end < todayIso) {
      signals.push({
        type: "gate_overdue",
        title: `Gate ${c.gate_code} ${c.area_name} ${label}`,
        detail: `${gateShortName(c.gate_code)} · target selesai ${end}`,
        href: `/project/${c.project_code}/schedule`,
        projectCode: c.project_code,
        dueLabel: label,
        dueDate: end,
      });
    } else if (end <= soonHorizon) {
      signals.push({
        type: "gate_soon",
        title: `Gate ${c.gate_code} ${c.area_name} jatuh tempo ${label}`,
        detail: `${gateShortName(c.gate_code)} · target selesai ${end}`,
        href: `/project/${c.project_code}/schedule`,
        projectCode: c.project_code,
        dueLabel: label,
        dueDate: end,
      });
    }
  }

  for (const r of findCascadeRisks(scheduleCells, todayIso)) {
    signals.push({
      type: "cascade_risk",
      title: `Gate ${r.gateCode} ${r.areaName} berisiko terlambat berantai`,
      detail: r.reason,
      href: `/project/${r.projectCode}/schedule`,
      projectCode: r.projectCode,
    });
  }

  // ── Live blockers: drop blocked events superseded by later work events ─────
  const blockedCardIds = [...new Set((blockedRaw ?? []).map((e) => e.card_id))];
  const lastNonBlockedByCard = new Map<string, OrderableEvent>();
  if (blockedCardIds.length > 0) {
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
  for (const e of (blockedRaw ?? []).slice()) {
    const cleared = lastNonBlockedByCard.get(e.card_id);
    if (cleared && compareEventTime(e, cleared) <= 0) continue;
    const c = (e as { cards: CardRef }).cards;
    const p = e.payload as { blocked_on?: string; description?: string };
    signals.push({
      type: "blocker",
      title: `Terblokir: ${c?.title ?? "(kartu)"}`,
      detail: p.blocked_on ?? p.description ?? undefined,
      href: cardHref(c),
      projectCode: c?.projects?.project_code ?? "?",
      dueLabel: e.occurred_at ? `macet ${ageLabelFor(e.occurred_at, now)}` : undefined,
      occurredAt: e.occurred_at,
    });
  }

  // ── Open decisions ──────────────────────────────────────────────────────────
  for (const e of decEvs ?? []) {
    const c = (e as { cards: CardRef }).cards;
    const p = e.payload as { topic?: string; proposed_spec?: string; awaiting?: string };
    const actor = p.awaiting ? ACTOR_LABELS[p.awaiting] ?? p.awaiting : null;
    signals.push({
      type: "decision_needed",
      title: `Butuh keputusan: ${p.topic ?? c?.title ?? "(kartu)"}`,
      detail: [p.proposed_spec, actor ? `menunggu ${actor}` : null].filter(Boolean).join(" · ") || undefined,
      href: cardHref(c),
      projectCode: c?.projects?.project_code ?? "?",
      dueLabel: e.occurred_at ? ageLabelFor(e.occurred_at, now) : undefined,
      occurredAt: e.occurred_at,
      // Decision payloads carry no deadline field today; when one exists the
      // ≤3-day boost in rank.ts kicks in automatically via dueDate.
    });
  }

  // ── Open client requests ────────────────────────────────────────────────────
  for (const e of crEvs ?? []) {
    const c = (e as { cards: CardRef }).cards;
    const p = e.payload as { request_text?: string; requested_by?: string };
    signals.push({
      type: "awaiting_client",
      title: `Permintaan klien terbuka: ${c?.title ?? "(kartu)"}`,
      detail: p.request_text || undefined,
      href: cardHref(c),
      projectCode: c?.projects?.project_code ?? "?",
      dueLabel: e.occurred_at ? ageLabelFor(e.occurred_at, now) : undefined,
      occurredAt: e.occurred_at,
    });
  }

  // ── Expiring quotes (no vendor picked yet) ─────────────────────────────────
  for (const e of findExpiringQuotes(
    (vendorEvs ?? []) as unknown as QuoteEvent[],
    todayIso,
    GATE_SOON_WINDOW_DAYS,
  )) {
    const c = ((e as unknown) as { cards: CardRef }).cards;
    const expires = e.payload.expires_at!;
    const label = dueLabelFor(expires, now);
    signals.push({
      type: "quote_expiring",
      title:
        expires < todayIso
          ? `Quote ${e.payload.vendor_name ?? "vendor"} sudah kedaluwarsa`
          : `Quote ${e.payload.vendor_name ?? "vendor"} kedaluwarsa ${label}`,
      detail: `berlaku sampai ${expires}`,
      href: cardHref(c),
      projectCode: c?.projects?.project_code ?? "?",
      dueLabel: label,
      dueDate: expires,
    });
  }

  // ── Stale active cards (no events in 30 days) ──────────────────────────────
  // Trello-import template cards (GUIDE / "YYYY-MM-DD - …" placeholders) are
  // permanently inactive by design — they'd flood the feed as false positives.
  const TEMPLATE_TITLE = /^(guide\b|yyyy-mm-dd)/i;
  for (const card of (staleCards ?? []).filter((c) => !TEMPLATE_TITLE.test(c.title ?? ""))) {
    const proj = (card as { projects: ProjRef }).projects;
    const age = card.last_event_at ? ageLabelFor(card.last_event_at, now) : null;
    signals.push({
      type: "stale_card",
      title: `Tanpa aktivitas${age ? ` ${age}` : ""}: ${card.title}`,
      href: proj ? `/project/${proj.project_code}/cards/${card.slug}` : "#",
      projectCode: proj?.project_code ?? "?",
      dueLabel: age ?? undefined,
      occurredAt: card.last_event_at,
    });
  }

  return {
    items: rankAdvisorItems(signals, now, opts.limit ?? 10),
    upcomingGateCells,
  };
}

export async function getAdvisorItems(
  supabase: SupabaseClient<Database>,
  opts: GetAdvisorOpts,
): Promise<AdvisorItem[]> {
  return (await getAdvisorData(supabase, opts)).items;
}
