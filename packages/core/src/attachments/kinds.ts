// Pure helpers for attachment MIME classification.
// Moved verbatim from apps/web/lib/attachments/analyze.ts — no server deps.

// The bucket caps files at 20 MB; mirror that so the runner skips anything larger.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// Image media types the Anthropic image block accepts. The bucket also allows
// HEIC/HEIF, but the vision API cannot take those — they get skipped, not failed.
const VISION_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export type AttachmentKind = "image" | "pdf";

export function attachmentKind(mimeType: string): AttachmentKind | null {
  if ((VISION_IMAGE_MEDIA_TYPES as readonly string[]).includes(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

/** Returns a skip reason string, or null if the file is processable. */
export function attachmentSkipReason(mimeType: string, sizeBytes: number): string | null {
  if (!attachmentKind(mimeType)) return "unsupported";
  if (sizeBytes > MAX_ATTACHMENT_BYTES) return "oversize";
  return null;
}
