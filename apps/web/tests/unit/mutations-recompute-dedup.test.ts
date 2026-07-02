import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Task 6.5: dedup the double recompute per request ──────────────────────
//
// createCardEvent / approveCardEventDraft in @/lib/cards/mutations both queue
// an after() callback that (a) drains pending AI step inference for the
// event's project, then (b) unconditionally recomputes gates for that same
// project. processPendingStepInference already recomputes internally for any
// project whose area_step_events it wrote (see run-inference.test.ts) — so
// the trailing unconditional call must skip any project inference already
// covered. This test captures the after() callback and invokes it directly
// against a fake supabase, mocking every other mutations.ts dependency so it
// stays fast and offline (mirrors run-inference.test.ts's mocking style).

const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", () => ({
  after: (cb: () => Promise<void>) => {
    afterCallbacks.push(cb);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "staff-1" } } }) },
    from: vi.fn().mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn().mockReturnValue({ __fake: "admin-client" }),
}));

vi.mock("@/lib/areas/match-hint", () => ({ suggestAreaForCard: vi.fn() }));
vi.mock("@/lib/notifications/producers", () => ({
  notifyMentions: vi.fn(),
  notifyWatchersOfEvent: vi.fn().mockResolvedValue(undefined),
  notifyCardStatusChange: vi.fn(),
  notifyDraftApproved: vi.fn().mockResolvedValue(undefined),
  notifyDraftRejected: vi.fn(),
  notifyDraftPending: vi.fn(),
  notifyPrincipalsOfHighRiskEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications/push-send", () => ({ sendExpoPush: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/gates/recompute-system", () => ({
  recomputeProjectGatesSystem: vi.fn().mockResolvedValue({ ok: true, cellsUpdated: 8, ruleVersion: 2 }),
}));
vi.mock("@/lib/steps/run-inference", () => ({ processPendingStepInference: vi.fn() }));

vi.mock("@datum/core", () => ({
  createCard: vi.fn(),
  createTopic: vi.fn(),
  moveCard: vi.fn(),
  createCardEvent: vi.fn().mockResolvedValue({ ok: true, eventId: "ev-1" }),
  collectPayloadFromEntries: vi.fn((entries: Iterable<[string, unknown]>) => Object.fromEntries(entries)),
  resolveCardEvent: vi.fn(),
  attachToEvent: vi.fn(),
  signAttachment: vi.fn(),
  reanalyzeAttachment: vi.fn(),
  createComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  addCardMember: vi.fn(),
  removeCardMember: vi.fn(),
  approveCardEventDraft: vi.fn().mockResolvedValue({
    ok: true,
    eventId: "ev-2",
    projectId: "p-1",
    projectCode: "BDG-H1",
    cardSlug: "km-utama",
    eventKind: "work",
    draftAuthorId: "staff-2",
    gateRelevant: true,
  }),
  rejectCardEventDraft: vi.fn(),
  linkCardToArea: vi.fn(),
  getProjectAreas: vi.fn(),
}));

import { createCardEvent, approveCardEventDraft } from "@/lib/cards/mutations";
import { processPendingStepInference } from "@/lib/steps/run-inference";
import { recomputeProjectGatesSystem } from "@/lib/gates/recompute-system";

const PROJECT_ID = "33333333-3333-3333-3333-333333333333";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Runs the single queued after() callback (asserts exactly one was queued). */
async function runAfterCallback(): Promise<void> {
  expect(afterCallbacks).toHaveLength(1);
  const cb = afterCallbacks[0];
  if (!cb) throw new Error("no after() callback was queued");
  await cb();
}

describe("mutations.ts after() recompute dedup (Task 6.5)", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    vi.mocked(recomputeProjectGatesSystem).mockClear();
    vi.mocked(processPendingStepInference).mockClear();
  });

  it("createCardEvent: skips the trailing recompute when inference already recomputed the project", async () => {
    vi.mocked(processPendingStepInference).mockResolvedValue({
      claimed: 1, done: 1, skipped: 0, failed: 0, recomputedProjects: [PROJECT_ID],
    });

    const result = await createCardEvent(formData({
      cardId: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
      projectCode: "BDG-H1",
      cardSlug: "km-utama",
      eventKind: "work",
      status: "done",
      description: "waterproofing selesai",
    }));
    expect(result.ok).toBe(true);

    await runAfterCallback();

    expect(processPendingStepInference).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).not.toHaveBeenCalled();
  });

  it("createCardEvent: trailing recompute still fires when inference claimed/recomputed nothing", async () => {
    vi.mocked(processPendingStepInference).mockResolvedValue({
      claimed: 0, done: 0, skipped: 0, failed: 0, recomputedProjects: [],
    });

    const result = await createCardEvent(formData({
      cardId: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
      projectCode: "BDG-H1",
      cardSlug: "km-utama",
      eventKind: "work",
      status: "done",
      description: "waterproofing selesai",
    }));
    expect(result.ok).toBe(true);

    await runAfterCallback();

    expect(processPendingStepInference).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).toHaveBeenCalledWith(PROJECT_ID, "BDG-H1");
  });

  it("createCardEvent: non-inferable kind never calls inference, trailing recompute fires unconditionally", async () => {
    const result = await createCardEvent(formData({
      cardId: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
      projectCode: "BDG-H1",
      cardSlug: "km-utama",
      eventKind: "decision",
      topic: "keputusan warna cat",
    }));
    expect(result.ok).toBe(true);

    await runAfterCallback();

    expect(processPendingStepInference).not.toHaveBeenCalled();
    expect(recomputeProjectGatesSystem).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).toHaveBeenCalledWith(PROJECT_ID, "BDG-H1");
  });

  it("approveCardEventDraft: skips the trailing recompute when inference already recomputed the project", async () => {
    vi.mocked(processPendingStepInference).mockResolvedValue({
      claimed: 1, done: 1, skipped: 0, failed: 0, recomputedProjects: ["p-1"],
    });

    const result = await approveCardEventDraft(formData({
      draftId: "22222222-2222-2222-2222-222222222222",
    }));
    expect(result.ok).toBe(true);

    await runAfterCallback();

    expect(processPendingStepInference).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).not.toHaveBeenCalled();
  });

  it("approveCardEventDraft: trailing recompute still fires when inference recomputed a different project", async () => {
    vi.mocked(processPendingStepInference).mockResolvedValue({
      claimed: 1, done: 1, skipped: 0, failed: 0, recomputedProjects: ["some-other-project"],
    });

    const result = await approveCardEventDraft(formData({
      draftId: "22222222-2222-2222-2222-222222222222",
    }));
    expect(result.ok).toBe(true);

    await runAfterCallback();

    expect(recomputeProjectGatesSystem).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).toHaveBeenCalledWith("p-1", "BDG-H1");
  });
});
