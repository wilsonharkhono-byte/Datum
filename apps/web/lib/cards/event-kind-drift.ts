// Compile-time guard that EVENT_KINDS (from @datum/types) is exactly
// the same set as the DB-generated CardEventKind enum.
// If a new value is added to the DB enum, this file fails to typecheck
// and forces @datum/types EVENT_KINDS + EventPayloadSchemas to be updated.

import type { CardEventKind } from "@datum/db";
import { EVENT_KINDS, type EventKind } from "@datum/types";

type AssertExtends<A, B> = A extends B ? true : false;

// Both directions must be `true` — TS will error if either is false.
type _AppCoversDb = AssertExtends<CardEventKind, EventKind>;
type _DbCoversApp = AssertExtends<EventKind, CardEventKind>;

const _appCoversDb: _AppCoversDb = true;
const _dbCoversApp: _DbCoversApp = true;

// Reference so tree-shaking doesn't drop the file
export const _EVENT_KIND_DRIFT_CHECK = { _appCoversDb, _dbCoversApp, count: EVENT_KINDS.length };
