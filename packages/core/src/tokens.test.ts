import { describe, it, expect } from "vitest";
import { COLORS, TYPE, SPACE, RADIUS, TOUCH_TARGET, FONT_FAMILY } from "./tokens";

describe("SANO tokens", () => {
  it("exposes the signature palette", () => {
    expect(COLORS.bg).toBe("#D2D0C4");
    expect(COLORS.surface).toBe("#FDFAF6");
    expect(COLORS.primary).toBe("#141210");
    expect(COLORS.accent).toBe("#B29F86");
  });
  it("exposes the flag colors", () => {
    expect(COLORS.ok).toBe("#3D8B40");
    expect(COLORS.critical).toBe("#C62828");
  });
  it("exposes scales + the 44dp touch target", () => {
    expect(TYPE.base).toBe(15);
    expect(SPACE.base).toBe(16);
    expect(RADIUS.base).toBe(8);
    expect(TOUCH_TARGET).toBe(44);
    expect(FONT_FAMILY).toBe("Space Grotesk");
  });
});
