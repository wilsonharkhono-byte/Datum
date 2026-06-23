// Thin re-export — logic lives in @datum/core (strangler pattern).
// Web components import from here unchanged; core is the source of truth.
export {
  evaluateGate,
  RULE_VERSION,
  RELEVANT_KINDS,
  type ReadinessState,
  type GateInput,
  type GateResult,
} from "@datum/core";
