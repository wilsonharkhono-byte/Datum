import { describe, expect, it } from "vitest";
import { applies } from "@/lib/steps/applicability";
import type { FinishProfile } from "@/lib/steps/types";

const marble: FinishProfile = { area_type: "bathroom", lantai: "marmer" };
const ceramic: FinishProfile = { area_type: "bathroom", lantai: "keramik" };

describe("applies", () => {
  it("empty applicability always matches", () => {
    expect(applies({}, marble)).toBe(true);
    expect(applies({}, ceramic)).toBe(true);
  });

  it("matches when the profile value is in the allowed set", () => {
    expect(applies({ lantai: ["marmer", "batu"] }, marble)).toBe(true);
  });

  it("does not match when the profile value is outside the allowed set", () => {
    expect(applies({ lantai: ["marmer", "batu"] }, ceramic)).toBe(false);
  });

  it("does not match when the profile is missing the key entirely", () => {
    expect(applies({ lantai: ["marmer"] }, { area_type: "bathroom" })).toBe(false);
  });

  it("requires ALL keys to match (logical AND across keys)", () => {
    const cond = { lantai: ["marmer"], dinding: ["batu"] };
    expect(applies(cond, { area_type: "bathroom", lantai: "marmer", dinding: "batu" })).toBe(true);
    expect(applies(cond, { area_type: "bathroom", lantai: "marmer", dinding: "cat" })).toBe(false);
  });
});
