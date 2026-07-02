// apps/web/tests/unit/step-infer-runner.test.ts
import { it, expect } from "vitest";
import { inferCardEventSteps } from "@/lib/steps/infer-runner";
import type { CandidateStep } from "@/lib/steps/infer";

const candidates: CandidateStep[] = [
  { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
];

it("returns a parsed verdict from the model response", async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify({ matches: [{ step_code: "BW1", status: "done", blocked_on: null, confidence: 0.95 }] }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };
  const { verdict, model } = await inferCardEventSteps({
    cardTitle: "KM Utama",
    eventText: "Waterproofing selesai",
    candidates,
    client: fakeClient as any,
  });
  expect(verdict.matches[0]!.step_code).toBe("BW1");
  expect(typeof model).toBe("string");
});
