import { z } from "zod";

export const EVENT_KINDS = [
  "decision","drawing","survey","vendor_quote","vendor_pick",
  "material","worker_assigned","progress","defect","photo",
  "document","client_request","note","pending",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

const DecisionPayload = z.object({
  topic: z.string().min(1),
  current_spec: z.string().optional(),
  proposed_spec: z.string().optional(),
  approved_by: z.enum(["client","principal","pic"]).optional(),
  approval_evidence: z.string().optional(),
});

const DrawingPayload = z.object({
  drawing_code: z.string().optional(),
  revision: z.string().optional(),
  description: z.string(),
  file_ref: z.string().optional(),
});

const SurveyPayload = z.object({
  vendor_name: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const VendorQuotePayload = z.object({
  vendor_id: z.string().uuid().optional(),
  vendor_name: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.literal("IDR").default("IDR"),
  quote_date: z.string(),
  expires_at: z.string().optional(),
  notes: z.string().optional(),
});

const VendorPickPayload = z.object({
  vendor_id: z.string().uuid().optional(),
  vendor_name: z.string().min(1),
  rationale: z.string().optional(),
});

const MaterialPayload = z.object({
  item: z.string().min(1),
  spec: z.string().optional(),
  status: z.enum(["specified","sample_approved","ordered","delivered"]),
  quantity: z.number().optional(),
  unit: z.string().optional(),
});

const WorkerAssignedPayload = z.object({
  worker_name: z.string().min(1),
  role: z.string().optional(),
  scope: z.string().optional(),
  start_date: z.string().optional(),
});

const ProgressPayload = z.object({
  status: z.string().min(1),
  percent_complete: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

const DefectPayload = z.object({
  description: z.string().min(1),
  severity: z.enum(["low","medium","high"]).default("medium"),
  location: z.string().optional(),
  fix_required_by: z.string().optional(),
});

const PhotoPayload = z.object({
  caption: z.string().optional(),
  taken_at: z.string().optional(),
});

const DocumentPayload = z.object({
  title: z.string().min(1),
  doc_type: z.string().optional(),
  notes: z.string().optional(),
});

const ClientRequestPayload = z.object({
  request_text: z.string().min(1),
  requested_by: z.string().optional(),
  awaiting: z.string().optional(),
});

const NotePayload = z.object({
  body: z.string().min(1),
});

const PendingPayload = z.object({
  what: z.string().min(1),
  blocked_on: z.string().optional(),
});

export const EventPayloadSchemas = {
  decision:        DecisionPayload,
  drawing:         DrawingPayload,
  survey:          SurveyPayload,
  vendor_quote:    VendorQuotePayload,
  vendor_pick:     VendorPickPayload,
  material:        MaterialPayload,
  worker_assigned: WorkerAssignedPayload,
  progress:        ProgressPayload,
  defect:          DefectPayload,
  photo:           PhotoPayload,
  document:        DocumentPayload,
  client_request:  ClientRequestPayload,
  note:            NotePayload,
  pending:         PendingPayload,
} as const satisfies Record<EventKind, z.ZodTypeAny>;

export type EventPayloadByKind = {
  [K in EventKind]: z.infer<(typeof EventPayloadSchemas)[K]>;
};

export function parseEventPayload<K extends EventKind>(
  kind: K,
  payload: unknown,
): EventPayloadByKind[K] {
  const schema = EventPayloadSchemas[kind];
  return schema.parse(payload) as EventPayloadByKind[K];
}

// Kinds that always carry cost-sensitive data → card_events.cost_visible = true.
export const COST_VISIBLE_KINDS: ReadonlySet<EventKind> = new Set([
  "vendor_quote",
]);

// Kinds that require human approval when captured via AI chat
// (cost-sensitive + client-facing + high-impact items)
export const HIGH_RISK_KINDS: ReadonlySet<EventKind> = new Set([
  "vendor_quote",
  "vendor_pick",
  "decision",
  "defect",
  "client_request",
]);
