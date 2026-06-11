import { z } from "zod";

export const EVENT_KINDS = [
  "decision","drawing","vendor","material","work","client_request","note","photo","document",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

// Optional reasoning string carried on events captured via the AI chat flow.
// Lets the principal see why the AI routed the event to this card/kind. Plain
// human-authored events leave it unset.
const aiRationale = { ai_rationale: z.string().optional() };

const DecisionPayload = z.object({
  topic: z.string().min(1),
  current_spec: z.string().optional(),
  proposed_spec: z.string().optional(),
  // Lifecycle: an open decision ("needs_decision") is the unit the board,
  // brief and reminders operate on. The transform below guarantees parsed
  // payloads always carry a status (the brief's contains-queries depend on
  // it); rows that predate the lifecycle backfill are still read defensively
  // via isDecisionOpen() below.
  status: z.enum(["needs_decision", "decided", "superseded"]).optional(),
  // Whose ball is it — drives the "Menunggu X" board label.
  awaiting: z.enum(["client", "principal", "pic", "contractor", "architect", "vendor"]).optional(),
  approved_by: z.enum(["client","principal","pic"]).optional(),
  approval_evidence: z.string().optional(),
  ...aiRationale,
})
  // Default depends on a sibling field, so a plain .default() won't do:
  // logging an already-approved decision must not create a phantom open loop.
  .transform((p) => ({
    ...p,
    status: p.status ?? (p.approved_by ? ("decided" as const) : ("needs_decision" as const)),
  }));

const DrawingPayload = z.object({
  drawing_code: z.string().optional(),
  revision: z.string().optional(),
  description: z.string().min(1),
  file_ref: z.string().optional(),
  ...aiRationale,
});

const VendorPayload = z.object({
  interaction: z.enum(["quote","pick","survey","contract"]),
  vendor_name: z.string().min(1),
  vendor_id: z.string().uuid().optional(),
  amount: z.number().nonnegative().optional(),
  currency: z.literal("IDR").default("IDR").optional(),
  quote_date: z.string().optional(),
  expires_at: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  notes: z.string().optional(),
  ...aiRationale,
});

const MaterialPayload = z.object({
  item: z.string().min(1),
  spec: z.string().optional(),
  status: z.enum(["specified","sample_approved","ordered","delivered"]),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  ...aiRationale,
});

const WorkPayload = z.object({
  status: z.enum(["assigned","in_progress","blocked","done"]),
  worker_name: z.string().optional(),
  role: z.string().optional(),
  scope: z.string().optional(),
  start_date: z.string().optional(),
  percent_complete: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
  severity: z.enum(["low","medium","high"]).optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  // Blocker: who/what the work is waiting on (shown as blocking reason).
  blocked_on: z.string().optional(),
  // Quality issue marker — distinguishes a defect from merely stalled work.
  issue: z.enum(["defect"]).optional(),
  fix_required_by: z.string().optional(),
  ...aiRationale,
});

const ClientRequestPayload = z.object({
  request_text: z.string().min(1),
  requested_by: z.string().optional(),
  awaiting: z.string().optional(),
  // New requests always start open so the brief's contains-query sees them.
  status: z.enum(["open", "answered"]).default("open"),
  ...aiRationale,
});

const NotePayload = z.object({
  body: z.string().min(1),
  ...aiRationale,
});

const PhotoPayload = z.object({
  caption: z.string().optional(),
  taken_at: z.string().optional(),
  ...aiRationale,
});

const DocumentPayload = z.object({
  title: z.string().min(1),
  doc_type: z.string().optional(),
  notes: z.string().optional(),
  ...aiRationale,
});

export const EventPayloadSchemas = {
  decision:        DecisionPayload,
  drawing:         DrawingPayload,
  vendor:          VendorPayload,
  material:        MaterialPayload,
  work:            WorkPayload,
  client_request:  ClientRequestPayload,
  note:            NotePayload,
  photo:           PhotoPayload,
  document:        DocumentPayload,
} as const satisfies Record<EventKind, z.ZodTypeAny>;

export type EventPayloadByKind = {
  [K in EventKind]: z.infer<(typeof EventPayloadSchemas)[K]>;
};

export function parseEventPayload<K extends EventKind>(
  kind: K,
  payload: unknown,
): EventPayloadByKind[K] {
  const schema = EventPayloadSchemas[kind];
  if (!schema) {
    throw new Error(`Unknown event_kind: ${String(kind)}`);
  }
  return schema.parse(payload) as EventPayloadByKind[K];
}

// Type-level assertion that EVENT_KINDS covers every card_event_kind from the DB.
// If a future DB migration adds a new enum value, regenerate types and this
// assertion will fail at compile time, forcing EVENT_KINDS + schemas to be
// updated in lockstep. Resolved at compile time only; no runtime cost.
//
// We can't import the DB type from @datum/db here (would create a circular
// dep: db package depends on types package). Instead the consuming app should
// add a parallel assertion. See apps/web/lib/cards/event-kind-drift.ts.

// Kinds that always carry cost-sensitive data → card_events.cost_visible = true.
export const COST_VISIBLE_KINDS: ReadonlySet<EventKind> = new Set([
  "vendor",  // any vendor interaction may carry an amount
]);

// Kinds that require human approval when captured via AI chat
// (cost-sensitive + client-facing + high-impact items)
export const HIGH_RISK_KINDS: ReadonlySet<EventKind> = new Set([
  "vendor",
  "decision",
  "client_request",
  "work",  // because work includes defects
]);

// ─── Open-loop helpers ────────────────────────────────────────────────────────
// "Open" decisions/requests are what labels, the brief, and reminders count.
// Legacy rows (pre-lifecycle backfill) may lack `status`; fall back sensibly.

export function isDecisionOpen(payload: {
  status?: string | null;
  approved_by?: string | null;
}): boolean {
  if (payload.status) return payload.status === "needs_decision";
  return !payload.approved_by;
}

export function isClientRequestOpen(payload: { status?: string | null }): boolean {
  return (payload.status ?? "open") === "open";
}
