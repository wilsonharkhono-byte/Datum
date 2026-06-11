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
  approved_by: z.enum(["client","principal","pic"]).optional(),
  approval_evidence: z.string().optional(),
  ...aiRationale,
});

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
  ...aiRationale,
});

const ClientRequestPayload = z.object({
  request_text: z.string().min(1),
  requested_by: z.string().optional(),
  awaiting: z.string().optional(),
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
