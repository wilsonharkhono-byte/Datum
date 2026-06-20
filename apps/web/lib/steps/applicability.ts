import type { FinishProfile } from "@/lib/steps/types";

/**
 * A step applies to an area when EVERY key in `applicability` has the area's
 * profile value present in the allowed set. An empty condition always applies.
 */
export function applies(
  applicability: Record<string, string[]>,
  profile: FinishProfile,
): boolean {
  for (const [key, allowed] of Object.entries(applicability)) {
    const value = profile[key];
    if (value === undefined || !allowed.includes(value)) return false;
  }
  return true;
}
