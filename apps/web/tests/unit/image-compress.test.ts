import { describe, expect, it } from "vitest";
import { targetDimensions } from "@/lib/projects/image-compress";

describe("targetDimensions", () => {
  it("leaves images already within the cap unchanged", () => {
    expect(targetDimensions(800, 600, 1600)).toEqual({ w: 800, h: 600 });
    expect(targetDimensions(1600, 900, 1600)).toEqual({ w: 1600, h: 900 });
  });
  it("scales the longest edge down to maxDim, preserving aspect (landscape)", () => {
    expect(targetDimensions(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
  });
  it("scales by the longest edge for portrait too", () => {
    expect(targetDimensions(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
  });
});
