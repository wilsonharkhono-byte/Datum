export type Tint = { bg: string; fg: string };

// Warm palette pairs (background tint + matched darker text), brand-safe, flat.
// Index 0 is the neutral/ungrouped tint.
export const TINTS: Tint[] = [
  { bg: "#E7E1D6", fg: "#7A6B56" },
  { bg: "#E8DFC9", fg: "#7A6531" },
  { bg: "#E0E2D2", fg: "#566436" },
  { bg: "#E6DCD2", fg: "#7A5B43" },
  { bg: "#DFE0DA", fg: "#55605A" },
  { bg: "#EADFDA", fg: "#8A5A4C" },
];

export function developmentTint(name: string): Tint {
  if (!name) return TINTS[0]!;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  // Skip index 0 (reserved for ungrouped) for real names.
  const idx = 1 + (hash % (TINTS.length - 1));
  return TINTS[idx]!;
}
