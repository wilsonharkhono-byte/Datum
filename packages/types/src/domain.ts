// Roles per spec §4
export const Roles = ["principal", "designer", "pic", "site_supervisor", "admin", "estimator"] as const;
export type Role = (typeof Roles)[number];

// Finishing gates A–H per SAN Finishing Guide Bab 2
export const GateCodes = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type GateCode = (typeof GateCodes)[number];

// Readiness state of an Area × Gate cell
export const ReadinessStates = [
  "not_started",
  "in_progress",
  "ready_for_handoff",
  "blocked",
  "passed",
  "not_applicable",
] as const;
export type ReadinessState = (typeof ReadinessStates)[number];

// Draft risk per spec §4 "Drafts, approval, risk classification"
export const RiskLevels = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RiskLevels)[number];

// Decision priority per Finishing Guide §1.2
export const DecisionPriorities = ["P1", "P2", "P3"] as const;
export type DecisionPriority = (typeof DecisionPriorities)[number];

// Project lifecycle status
export const ProjectStatuses = ["design", "construction", "finishing", "handover", "closed"] as const;
export type ProjectStatus = (typeof ProjectStatuses)[number];
