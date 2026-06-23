import { coverImageUrl as coreCoverImageUrl } from "@datum/core";

export function coverImageUrl(path: string | null | undefined): string | null {
  return coreCoverImageUrl(path, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}
