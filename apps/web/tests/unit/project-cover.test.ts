import { describe, expect, it, beforeAll } from "vitest";
import { coverImageUrl } from "@/lib/projects/cover";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
});

describe("coverImageUrl", () => {
  it("returns null for null/empty paths", () => {
    expect(coverImageUrl(null)).toBeNull();
    expect(coverImageUrl("")).toBeNull();
  });
  it("builds a public storage URL", () => {
    expect(coverImageUrl("abc/123-render.jpg")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/project-covers/abc/123-render.jpg",
    );
  });
  it("encodes spaces in the path", () => {
    expect(coverImageUrl("abc/my render.png")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/project-covers/abc/my%20render.png",
    );
  });
});
