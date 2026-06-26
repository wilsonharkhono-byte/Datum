import type { GateCode } from "@datum/types";

export const GATE_SHORT_NAME: Record<GateCode, string> = {
  A: "MEP Rough-in",
  B: "Pekerjaan Basah",
  C: "Plafon",
  D: "Lantai & Kusen",
  E: "Cat & Ironwork",
  F: "Furniture",
  G: "MEP Fit-out",
  H: "Serah Terima",
};

export function gateLabel(code: string): string {
  const short = GATE_SHORT_NAME[code as GateCode];
  return short ? `${code} · ${short}` : code;
}

export function gateShortName(code: string): string {
  return GATE_SHORT_NAME[code as GateCode] ?? code;
}
