// apps/web/lib/assistant/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";

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
 * Anthropic API caches it as a prefix. SDK 0.30.x only exposes cache_control
 * via the prompt-caching beta namespace (client.beta.promptCaching.messages),
 * which auto-sends the `anthropic-beta: prompt-caching-2024-07-31` header.
 * The per-request KONTEKS block stays in the user message — it changes every
 * request and must NOT be cached.
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
  return getAnthropicClient().beta.promptCaching.messages.stream({
    model: getModel(),
    max_tokens: 1024,
    system: cachedSystemBlock(SYSTEM),
    messages: [{ role: "user", content: buildUserContent(args) }],
  });
}

export type AssistantStream = ReturnType<typeof streamAssistant>;

/** Non-streaming variant, kept for callers that need the full answer at once. */
export async function askAssistant(args: {
  question: string;
  contextBlock: string;
}): Promise<{ answer: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await getAnthropicClient().beta.promptCaching.messages.create({
    model: getModel(),
    max_tokens: 1024,
    system: cachedSystemBlock(SYSTEM),
    messages: [{ role: "user", content: buildUserContent(args) }],
  });
  const text = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
  return {
    answer: text,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}

export function extractCitations(answer: string): { cardId: string; eventIds: string[] }[] {
  const map = new Map<string, Set<string>>();
  const cardRe = /\[card:([0-9a-f-]{36})\]/gi;
  const eventRe = /\[event:([0-9a-f-]{36})\]/gi;
  for (const m of answer.matchAll(cardRe)) {
    if (!map.has(m[1]!)) map.set(m[1]!, new Set());
  }
  for (const m of answer.matchAll(eventRe)) {
    const card = [...map.keys()][map.size - 1]; // best-effort: attach to last mentioned card
    if (card) map.get(card)!.add(m[1]!);
  }
  return [...map.entries()].map(([cardId, eventIds]) => ({ cardId, eventIds: [...eventIds] }));
}
