import { describe, it, expect } from "vitest";
import { isCronAuthorized, isMissingFunctionError } from "@/lib/cron/auth";

it("authorizes only the correct bearer", () => {
  const req = new Request("https://x", { headers: { authorization: "Bearer s3cret" } });
  expect(isCronAuthorized(req, "s3cret")).toBe(true);
  expect(isCronAuthorized(req, "other")).toBe(false);
  expect(isCronAuthorized(req, undefined)).toBe(false);
});

it("detects the missing-RPC error", () => {
  expect(isMissingFunctionError({ code: "PGRST202", message: null })).toBe(true);
  expect(isMissingFunctionError({ code: null, message: "boom" })).toBe(false);
  expect(isMissingFunctionError({ code: null, message: "could not find the function foo" })).toBe(true);
});
