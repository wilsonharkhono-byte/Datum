// Thin re-export — logic lives in @datum/core (strangler pattern).
// Web components import from here unchanged; core is the source of truth.
export {
  overlayAreaTargetDates,
  shiftIsoDate,
  type ScheduledCell,
} from "@datum/core";
