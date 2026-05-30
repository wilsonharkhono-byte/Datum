export type { Database, Json } from "./types.generated";

import type { Database } from "./types.generated";

// Convenience row types
export type Tables = Database["public"]["Tables"];
export type Enums = Database["public"]["Enums"];

export type Staff = Tables["staff"]["Row"];
export type Project = Tables["projects"]["Row"];
export type Area = Tables["areas"]["Row"];
export type Gate = Tables["gates"]["Row"];
export type GateCheckpointTemplate = Tables["gate_checkpoint_templates"]["Row"];
export type ProjectGate = Tables["project_gates"]["Row"];
export type AreaGateStatus = Tables["area_gate_status"]["Row"];
export type ProjectEvent = Tables["project_events"]["Row"];
export type RecordRevision = Tables["record_revisions"]["Row"];
