import type { TradeStepDep } from "@/lib/steps/types";

export type AreaFlags = {
  readyToStart: string | null;
  needsDecision: string[];
  blocked: string[];
};

type FlagStep = { step_code: string; step_type: string; status: string };

const DONE = new Set(["accepted", "done_with_defects"]);

export function computeAreaFlags(steps: FlagStep[], deps: TradeStepDep[]): AreaFlags {
  const status = new Map(steps.map((s) => [s.step_code, s.status]));
  const predsOf = new Map<string, string[]>();
  for (const s of steps) predsOf.set(s.step_code, []);
  for (const d of deps) {
    if (predsOf.has(d.step_code)) predsOf.get(d.step_code)!.push(d.predecessor_code);
  }

  const blocked = steps
    .filter((s) => s.status === "blocked" || s.status === "stalled")
    .map((s) => s.step_code);

  const isReady = (code: string) =>
    status.get(code) === "not_started" &&
    predsOf.get(code)!.every((p) => !status.has(p) || status.get(p) === "accepted");
  const readyToStart = steps.find((s) => isReady(s.step_code))?.step_code ?? null;

  const notStarted = new Set(steps.filter((s) => s.status === "not_started").map((s) => s.step_code));
  const gatesANotStarted = (code: string) =>
    steps.some((s) => notStarted.has(s.step_code) && predsOf.get(s.step_code)!.includes(code));
  const needsDecision = steps
    .filter((s) => (s.step_type === "decision" || s.step_type === "procurement"))
    .filter((s) => !DONE.has(s.status))
    .filter((s) => gatesANotStarted(s.step_code))
    .map((s) => s.step_code);

  return { readyToStart, needsDecision, blocked };
}
