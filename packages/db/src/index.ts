export type { Database, Json } from "./types.generated";

import type { Database } from "./types.generated";

// Convenience row types
export type Tables = Database["public"]["Tables"];
export type Enums = Database["public"]["Enums"];

// Slice 0 backbone
export type Staff = Tables["staff"]["Row"];
export type Project = Tables["projects"]["Row"];
export type Area = Tables["areas"]["Row"];
export type Gate = Tables["gates"]["Row"];
export type GateCheckpointTemplate = Tables["gate_checkpoint_templates"]["Row"];
export type ProjectGate = Tables["project_gates"]["Row"];
export type AreaGateStatus = Tables["area_gate_status"]["Row"];
export type ProjectEvent = Tables["project_events"]["Row"];
export type RecordRevision = Tables["record_revisions"]["Row"];

// Slice 1.0 — discussion layer
export type Topic = Tables["topics"]["Row"];
export type TopicNote = Tables["topic_notes"]["Row"];
export type Drawing = Tables["drawings"]["Row"];
export type DrawingRevision = Tables["drawing_revisions"]["Row"];
export type Attachment = Tables["attachments"]["Row"];

// Slice 1.0 — readiness inputs
export type AreaGateCheckpoint = Tables["area_gate_checkpoints"]["Row"];
export type AreaGateBlocker = Tables["area_gate_blockers"]["Row"];
export type Decision = Tables["decisions"]["Row"];
export type MaterialItem = Tables["material_items"]["Row"];
export type MaterialMilestone = Tables["material_milestones"]["Row"];

// Slice 1.0 — cost layer (rows filtered by RLS for non-cost-visible users)
export type Vendor = Tables["vendors"]["Row"];
export type VendorQuote = Tables["vendor_quotes"]["Row"];
export type Invoice = Tables["invoices"]["Row"];

// Slice 1.0 — drafts + review
export type DataDraft = Tables["data_drafts"]["Row"];
export type ReviewQueueItem = Tables["review_queue"]["Row"];

// Slice 1.1 — cards layer
export type Card             = Tables["cards"]["Row"];
export type CardArea         = Tables["card_areas"]["Row"];
export type CardEvent        = Tables["card_events"]["Row"];
export type CardAttachment   = Tables["card_attachments"]["Row"];
export type CardLink         = Tables["card_links"]["Row"];
export type CardEventKind    = Enums["card_event_kind"];
export type CardStatus       = Enums["card_status"];
export type CardLinkRelation = Enums["card_link_relation"];
export type CardEventSource  = Enums["card_event_source"];

// Slice 1.1 — assistant audit (tables created in 20260601000007)
export type AssistantSession      = Tables["assistant_sessions"]["Row"];
export type AssistantMessage      = Tables["assistant_messages"]["Row"];
export type AssistantQueryAudit   = Tables["assistant_query_audit"]["Row"];
export type AssistantMessageRole  = Enums["assistant_message_role"];

// Slice 1.1.3 — comments
export type CardComment = Tables["card_comments"]["Row"];
