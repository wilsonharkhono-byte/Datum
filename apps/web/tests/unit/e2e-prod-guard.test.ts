import { describe, it, expect } from "vitest";
import { PROD_SUPABASE_REF, assertNotProdSupabaseUrl } from "@/lib/e2e/prod-guard";

describe("assertNotProdSupabaseUrl", () => {
  it("does not throw for a local Supabase URL", () => {
    expect(() => assertNotProdSupabaseUrl("http://127.0.0.1:55321")).not.toThrow();
  });

  it("does not throw for an undefined URL (nothing configured yet)", () => {
    expect(() => assertNotProdSupabaseUrl(undefined)).not.toThrow();
  });

  it("does not throw for some other Supabase project's URL", () => {
    expect(() => assertNotProdSupabaseUrl("https://someotherref.supabase.co")).not.toThrow();
  });

  it("throws when the URL contains the prod project ref", () => {
    expect(() =>
      assertNotProdSupabaseUrl(`https://${PROD_SUPABASE_REF}.supabase.co`),
    ).toThrow(/prod/i);
  });

  it("throws regardless of protocol/case around the ref", () => {
    expect(() =>
      assertNotProdSupabaseUrl(`https://${PROD_SUPABASE_REF.toUpperCase()}.supabase.co`),
    ).toThrow();
  });

  it("error message names the offending env var for a fast fix", () => {
    expect(() => assertNotProdSupabaseUrl(`https://${PROD_SUPABASE_REF}.supabase.co`)).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });
});
