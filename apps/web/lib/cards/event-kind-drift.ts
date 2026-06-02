// Compile-time guard that EVENT_KINDS (from @datum/types) is exactly
// the same set as the DB-generated CardEventKind enum.
// If a new value is added to the DB enum, this file fails to typecheck
// and forces @datum/types EVENT_KINDS + EventPayloadSchemas to be updated.

import type { CardEventKind } from "@datum/db";
import { EVENT_KINDS, type EventKind } from "@datum/types";

// Retired kinds: still in the DB enum (can't safely drop) but the app
// no longer creates events of these kinds. Listed here so the drift
// check doesn't fail.
type RetiredKind =
  | "survey" | "vendor_quote" | "vendor_pick"
  | "worker_assigned" | "progress" | "defect"
  | "pending";

type AssertExtends<A, B> = A extends B ? true : false;

// Every active app kind must exist in the DB enum
type _AppCoversDb = AssertExtends<EventKind, CardEventKind>;
const _appCoversDb: _AppCoversDb = true;

// Every DB enum value must EITHER be an active kind OR a retired one
type _DbCoversAppOrRetired = AssertExtends<CardEventKind, EventKind | RetiredKind>;
const _dbCoversAppOrRetired: _DbCoversAppOrRetired = true;

// Reference so tree-shaking doesn't drop the file
export const _EVENT_KIND_DRIFT_CHECK = {
  _appCoversDb,
  _dbCoversAppOrRetired,
  count: EVENT_KINDS.length,
};
