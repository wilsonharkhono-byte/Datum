import { describe, expect, it } from "vitest";
import { attachmentKind, attachmentSkipReason, MAX_ATTACHMENT_BYTES } from "./kinds";

// These tests are ported from apps/web/tests/unit/analyze.test.ts
// (the pure-helper portion — buildDescribeMessages and server-only helpers stay in web).

describe("MAX_ATTACHMENT_BYTES", () => {
  it("is 20 MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("attachmentKind", () => {
  it("maps SDK-supported images to image", () => {
    expect(attachmentKind("image/jpeg")).toBe("image");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("image/gif")).toBe("image");
    expect(attachmentKind("image/webp")).toBe("image");
  });

  it("maps pdf to pdf", () => {
    expect(attachmentKind("application/pdf")).toBe("pdf");
  });

  it("returns null for types the vision API cannot take", () => {
    expect(attachmentKind("text/plain")).toBeNull();
    expect(attachmentKind("application/zip")).toBeNull();
    // HEIC/HEIF are allowed by the bucket but unsupported as image blocks.
    expect(attachmentKind("image/heic")).toBeNull();
    expect(attachmentKind("image/heif")).toBeNull();
  });
});

describe("attachmentSkipReason", () => {
  it("returns 'unsupported' for unsupported mime types", () => {
    expect(attachmentSkipReason("text/plain", 10)).toBe("unsupported");
    expect(attachmentSkipReason("application/zip", 100)).toBe("unsupported");
    expect(attachmentSkipReason("image/heic", 100)).toBe("unsupported");
  });

  it("returns 'oversize' when file exceeds MAX_ATTACHMENT_BYTES", () => {
    expect(attachmentSkipReason("image/png", MAX_ATTACHMENT_BYTES + 1)).toBe("oversize");
    expect(attachmentSkipReason("application/pdf", MAX_ATTACHMENT_BYTES + 1)).toBe("oversize");
  });

  it("returns null for processable files (supported mime + within size)", () => {
    expect(attachmentSkipReason("application/pdf", 1000)).toBeNull();
    expect(attachmentSkipReason("image/jpeg", 1000)).toBeNull();
    expect(attachmentSkipReason("image/png", MAX_ATTACHMENT_BYTES)).toBeNull();
  });
});
