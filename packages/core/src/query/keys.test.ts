import { describe, it, expect } from "vitest";
import { keys, PERSISTED_KEY_ROOTS } from "./keys";

describe("query keys", () => {
  it("builds exact tuples", () => {
    expect(keys.board("ARIN-1")).toEqual(["board", "ARIN-1"]);
    expect(keys.projects()).toEqual(["projects"]);
    expect(keys.card("ARIN-1", "kitchen")).toEqual(["card", "ARIN-1", "kitchen"]);
    expect(keys.brief()).toEqual(["brief"]);
    expect(keys.advisor("all")).toEqual(["advisor", "all"]);
    expect(keys.reviewDrafts()).toEqual(["review", "drafts"]);
    expect(keys.notifications("staff-123")).toEqual(["notifications", "staff-123"]);
    expect(keys.unreadCount("staff-123")).toEqual(["notifications", "staff-123", "unread"]);
    expect(keys.activity()).toEqual(["activity"]);
  });
  it("builds schedule/matrix/gates tuples", () => {
    expect(keys.schedule("proj-uuid")).toEqual(["schedule", "proj-uuid"]);
    expect(keys.areaTargets("proj-uuid")).toEqual(["areaTargets", "proj-uuid"]);
    expect(keys.matrix("proj-uuid")).toEqual(["matrix", "proj-uuid"]);
    expect(keys.gateCheckpoints("A")).toEqual(["gateCheckpoints", "A"]);
  });
  it("builds rooms/areas tuples", () => {
    expect(keys.rooms("ARIN-1")).toEqual(["rooms", "ARIN-1"]);
    expect(keys.areas("proj-uuid")).toEqual(["areas", "proj-uuid"]);
    expect(keys.areaProposal("proj-uuid")).toEqual(["areaProposal", "proj-uuid"]);
  });
  it("declares the persisted roots", () => {
    expect(PERSISTED_KEY_ROOTS).toEqual(["board", "projects", "card", "brief", "advisor", "review", "notifications", "activity", "schedule", "areaTargets", "matrix", "gateCheckpoints", "rooms", "areas"]);
  });
  it("areaProposal is NOT in PERSISTED_KEY_ROOTS", () => {
    expect((PERSISTED_KEY_ROOTS as readonly string[]).includes("areaProposal")).toBe(false);
  });
});
