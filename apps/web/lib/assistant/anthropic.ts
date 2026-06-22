// apps/web/lib/assistant/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
export { extractCitations } from "@datum/core";

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY not set");
    this.name = "AnthropicNotConfiguredError";
  }
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export function getModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

const SYSTEM = `Anda adalah asisten internal DATUM untuk WHAstudio.

ATURAN:
- Selalu menjawab dalam Bahasa Indonesia.
- Hanya gunakan informasi dari blok KONTEKS di bawah. Jangan menebak.
- Setiap fakta yang Anda sebutkan WAJIB disertai citation token [card:UUID] atau [event:UUID] dari konteks.
- Jika informasi tidak ada di konteks, jawab dengan jujur "informasi belum tercatat di kartu".
- Format jawaban: 1–4 kalimat ringkas, lalu daftar bullet jika ada beberapa fakta.
- Jangan ulangi pertanyaan pengguna.`;

let client: Anthropic | null = null;
export function getAnthropicClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new AnthropicNotConfiguredError();
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Static system prompt sent as a content-block array with cache_control so the
 * Anthropic API caches it as a prefix. Prompt caching is GA on the stable
 * Messages API (no beta namespace / header needed); cache_control lives on the
 * system text block. The per-request KONTEKS block stays in the user message —
 * it changes every request and must NOT be cached.
 */
export function cachedSystemBlock(text: string) {
  return [
    {
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

function buildUserContent(args: { question: string; contextBlock: string }): string {
  return `KONTEKS:\n${args.contextBlock}\n\nPERTANYAAN: ${args.question}`;
}

/**
 * Streaming variant for the Tanya flow. Returns the SDK MessageStream so the
 * route handler can pipe text deltas to the browser as they arrive.
 * Use `.on("text", ...)` for deltas and `await .finalMessage()` for usage.
 */
export function streamAssistant(args: { question: string; contextBlock: string }) {
  return getAnthropicClient().messages.stream({
    model: getModel(),
    max_tokens: 1024,
    system: cachedSystemBlock(SYSTEM),
    messages: [{ role: "user", content: buildUserContent(args) }],
  });
}

export type AssistantStream = ReturnType<typeof streamAssistant>;

/**
 * Concatenate the text blocks of a model response into one string. Modern SDK
 * `content` is a union (text, thinking, tool_use, …); we keep only text blocks.
 */
export function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/** Non-streaming variant, kept for callers that need the full answer at once. */
export async function askAssistant(args: {
  question: string;
  contextBlock: string;
}): Promise<{ answer: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await getAnthropicClient().messages.create({
    model: getModel(),
    max_tokens: 1024,
    system: cachedSystemBlock(SYSTEM),
    messages: [{ role: "user", content: buildUserContent(args) }],
  });
  const text = textOf(res.content);
  return {
    answer: text,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}

// extractCitations is re-exported from @datum/core (see top of file)
