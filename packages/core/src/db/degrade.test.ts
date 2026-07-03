import { describe, expect, it } from "vitest";
import { isMissingSchemaError } from "./degrade";

const ATTRIBUTION_ALLOWLIST = ["source", "confidence", "card_event_id", "ai_step_status", "ai_step_error"];

describe("isMissingSchemaError", () => {
  it("returns false for null", () => {
    expect(isMissingSchemaError(null, ATTRIBUTION_ALLOWLIST)).toBe(false);
  });

  it("detects an allowlisted missing-column error by code (42703) with no message", () => {
    expect(isMissingSchemaError({ code: "42703", message: null }, ATTRIBUTION_ALLOWLIST)).toBe(true);
  });

  it("detects an allowlisted missing-column error via 'column ... does not exist' message", () => {
    expect(
      isMissingSchemaError(
        { code: null, message: 'column area_step_events.source does not exist' },
        ATTRIBUTION_ALLOWLIST,
      ),
    ).toBe(true);
  });

  it("detects an allowlisted PGRST200 missing-relationship error by code", () => {
    expect(
      isMissingSchemaError({ code: "PGRST200", message: null }, ATTRIBUTION_ALLOWLIST),
    ).toBe(true);
  });

  it("detects an allowlisted missing-relationship error via message text mentioning 'relationship'", () => {
    expect(
      isMissingSchemaError(
        {
          code: null,
          message:
            "Could not find a relationship between 'area_step_events' and 'card_event_id' in the schema cache",
        },
        ATTRIBUTION_ALLOWLIST,
      ),
    ).toBe(true);
  });

  it("returns false for an unrelated error code/message", () => {
    expect(isMissingSchemaError({ code: "23505", message: "duplicate key" }, ATTRIBUTION_ALLOWLIST)).toBe(false);
  });

  it("returns false (lets it throw) for a missing-column error whose column is NOT in the allowlist", () => {
    expect(
      isMissingSchemaError(
        { code: "42703", message: 'column area_step_events.some_unrelated_column does not exist' },
        ATTRIBUTION_ALLOWLIST,
      ),
    ).toBe(false);
  });

  it("returns false for a PGRST301 (JWT expired) error even though it's a PostgREST error", () => {
    expect(isMissingSchemaError({ code: "PGRST301", message: "JWT expired" }, ATTRIBUTION_ALLOWLIST)).toBe(false);
  });

  it("respects a caller-specific allowlist scoped to a single column", () => {
    expect(
      isMissingSchemaError({ code: "42703", message: 'column "card_event_id" does not exist' }, ["card_event_id"]),
    ).toBe(true);
    expect(
      isMissingSchemaError({ code: "42703", message: 'column "some_other_col" does not exist' }, ["card_event_id"]),
    ).toBe(false);
  });
});
