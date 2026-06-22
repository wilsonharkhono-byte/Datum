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
  it("declares the persisted roots", () => {
    expect(PERSISTED_KEY_ROOTS).toEqual(["board", "projects", "card", "brief", "advisor", "review", "notifications", "activity"]);
  });
});
