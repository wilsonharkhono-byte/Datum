import { describe, expect, it } from "vitest";
import {
  attachmentKind,
  attachmentSkipReason,
  buildDescribeMessages,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachments/analyze";

describe("attachmentKind", () => {
  it("maps SDK-supported images to image and pdf to pdf", () => {
    expect(attachmentKind("image/jpeg")).toBe("image");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("image/webp")).toBe("image");
    expect(attachmentKind("application/pdf")).toBe("pdf");
  });
  it("returns null for types the vision API can't take", () => {
    expect(attachmentKind("text/plain")).toBeNull();
    expect(attachmentKind("application/zip")).toBeNull();
    // HEIC/HEIF are allowed by the bucket but unsupported as image blocks.
    expect(attachmentKind("image/heic")).toBeNull();
  });
});

describe("attachmentSkipReason", () => {
  it("skips unsupported mime", () => {
    expect(attachmentSkipReason("text/plain", 10)).toBe("unsupported");
  });
  it("skips oversize files", () => {
    expect(attachmentSkipReason("image/png", MAX_ATTACHMENT_BYTES + 1)).toBe("oversize");
  });
  it("allows supported, in-size files", () => {
    expect(attachmentSkipReason("application/pdf", 1000)).toBeNull();
    expect(attachmentSkipReason("image/jpeg", 1000)).toBeNull();
  });
});

describe("buildDescribeMessages", () => {
  it("uses an image block for images", () => {
    const msgs = buildDescribeMessages({ kind: "image", base64: "AAA", mimeType: "image/jpeg" });
    const block = (msgs[0]!.content as any[])[0];
    expect(block.type).toBe("image");
    expect(block.source.type).toBe("base64");
    expect(block.source.media_type).toBe("image/jpeg");
    expect(block.source.data).toBe("AAA");
    expect((msgs[0]!.content as any[])[1].type).toBe("text");
  });
  it("uses a document block for pdfs", () => {
    const msgs = buildDescribeMessages({ kind: "pdf", base64: "BBB", mimeType: "application/pdf" });
    const block = (msgs[0]!.content as any[])[0];
    expect(block.type).toBe("document");
    expect(block.source.type).toBe("base64");
    expect(block.source.media_type).toBe("application/pdf");
    expect(block.source.data).toBe("BBB");
  });
});
