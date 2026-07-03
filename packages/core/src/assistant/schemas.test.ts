import { describe, expect, it } from "vitest";
import { ChatRequest, CaptureRequest } from "./schemas";

const UUID = "00000000-0000-0000-0000-000000000001";

describe("ChatRequest", () => {
  it("accepts a valid request", () => {
    expect(() =>
      ChatRequest.parse({ projectId: UUID, question: "Apa status proyek?" }),
    ).not.toThrow();
  });

  it("accepts optional sessionId", () => {
    expect(() =>
      ChatRequest.parse({ projectId: UUID, question: "Apa?", sessionId: UUID }),
    ).not.toThrow();
  });

  // Phase 3 Task 5 (portfolio PM mode): projectId is OPTIONAL — an absent
  // projectId puts the assistant route into its cross-project /brief branch.
  // Existing callers (web project pages, mobile) always send one and are
  // unaffected; only a missing key is now valid, not a malformed one.
  it("accepts a missing projectId (portfolio mode)", () => {
    const parsed = ChatRequest.parse({ question: "Apa?" });
    expect(parsed.projectId).toBeUndefined();
  });

  it("rejects non-uuid projectId", () => {
    expect(() => ChatRequest.parse({ projectId: "bukan-uuid", question: "Apa?" })).toThrow();
  });

  it("rejects empty question", () => {
    expect(() => ChatRequest.parse({ projectId: UUID, question: "" })).toThrow();
  });

  it("rejects question longer than 2000 chars", () => {
    expect(() =>
      ChatRequest.parse({ projectId: UUID, question: "x".repeat(2001) }),
    ).toThrow();
  });

  it("accepts question of exactly 2000 chars", () => {
    expect(() =>
      ChatRequest.parse({ projectId: UUID, question: "x".repeat(2000) }),
    ).not.toThrow();
  });
});

describe("CaptureRequest", () => {
  it("accepts a minimal valid request", () => {
    expect(() =>
      CaptureRequest.parse({ projectId: UUID, text: "Cek besi kolom." }),
    ).not.toThrow();
  });

  it("accepts with optional file", () => {
    expect(() =>
      CaptureRequest.parse({
        projectId: UUID,
        text: "Photo attachment",
        file: { name: "foto.jpg", mime: "image/jpeg", size: 1024 },
      }),
    ).not.toThrow();
  });

  it("rejects text longer than 4000 chars", () => {
    expect(() =>
      CaptureRequest.parse({ projectId: UUID, text: "x".repeat(4001) }),
    ).toThrow();
  });

  it("accepts text of exactly 4000 chars", () => {
    expect(() =>
      CaptureRequest.parse({ projectId: UUID, text: "x".repeat(4000) }),
    ).not.toThrow();
  });

  it("rejects file.size over 20MB", () => {
    expect(() =>
      CaptureRequest.parse({
        projectId: UUID,
        text: "ok",
        file: { name: "big.pdf", mime: "application/pdf", size: 20_971_521 },
      }),
    ).toThrow();
  });

  it("accepts file.size of exactly 20MB", () => {
    expect(() =>
      CaptureRequest.parse({
        projectId: UUID,
        text: "ok",
        file: { name: "big.pdf", mime: "application/pdf", size: 20_971_520 },
      }),
    ).not.toThrow();
  });

  it("rejects non-uuid projectId", () => {
    expect(() => CaptureRequest.parse({ projectId: "bukan-uuid", text: "ok" })).toThrow();
  });
});
