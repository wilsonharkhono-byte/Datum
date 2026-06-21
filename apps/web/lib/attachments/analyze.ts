import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, getModel, textOf } from "@/lib/assistant/anthropic";
import {
  attachmentKind as _attachmentKind,
  attachmentSkipReason as _attachmentSkipReason,
  MAX_ATTACHMENT_BYTES as _MAX_ATTACHMENT_BYTES,
  type AttachmentKind as _AttachmentKind,
} from "@datum/core";

// Re-export the pure helpers from core so all callers importing from here
// (including the web analyze.test.ts) keep working unchanged.
export const MAX_ATTACHMENT_BYTES = _MAX_ATTACHMENT_BYTES;
export type AttachmentKind = _AttachmentKind;
export const attachmentKind = _attachmentKind;
export const attachmentSkipReason = _attachmentSkipReason;

// Image media types — kept here for the document block type narrowing below.
const VISION_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type VisionImageMediaType = (typeof VISION_IMAGE_MEDIA_TYPES)[number];

const DESCRIBE_INSTRUCTION = `Anda asisten internal DATUM (studio interior/konstruksi).
Deskripsikan lampiran ini dalam Bahasa Indonesia, 1–3 kalimat ringkas, agar mudah dicari kembali nanti.
- Foto material/marmer: sebutkan warna, motif/urat, dan finish (matte/polish) bila terlihat.
- Gambar kerja/denah (PDF): sebutkan jenis gambar dan kode/revisi bila terbaca.
- Penawaran/quote (PDF): sebutkan nama vendor, perkiraan total, dan masa berlaku bila terbaca.
Hanya sebut yang benar-benar terlihat/terbaca. Untuk hal yang tidak jelas tulis "tidak terbaca". Jangan menebak.`;

export function buildDescribeMessages(args: {
  kind: AttachmentKind;
  base64: string;
  mimeType: string;
}): Anthropic.MessageParam[] {
  const media: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam =
    args.kind === "image"
      ? {
          type: "image",
          source: { type: "base64", media_type: args.mimeType as VisionImageMediaType, data: args.base64 },
        }
      : {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: args.base64 },
        };
  return [{ role: "user", content: [media, { type: "text", text: DESCRIBE_INSTRUCTION }] }];
}

export type DescribeResult = {
  caption: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

/** Calls the vision model for a description. Throws on unsupported mime or API error. */
export async function describeAttachment(args: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<DescribeResult> {
  const kind = attachmentKind(args.mimeType);
  if (!kind) throw new Error("unsupported_mime");
  const base64 = Buffer.from(args.bytes).toString("base64");
  const model = getModel();
  const res = await getAnthropicClient().messages.create({
    model,
    max_tokens: 512,
    messages: buildDescribeMessages({ kind, base64, mimeType: args.mimeType }),
  });
  return {
    caption: textOf(res.content).trim(),
    model,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}
