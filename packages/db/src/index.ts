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
