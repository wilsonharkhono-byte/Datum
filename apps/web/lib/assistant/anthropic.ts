// apps/web/lib/assistant/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Anda adalah asisten internal DATUM untuk WHAstudio.

ATURAN:
- Selalu menjawab dalam Bahasa Indonesia.
- Hanya gunakan informasi dari blok KONTEKS di bawah. Jangan menebak.
- Setiap fakta yang Anda sebutkan WAJIB disertai citation token [card:UUID] atau [event:UUID] dari konteks.
- Jika informasi tidak ada di konteks, jawab dengan jujur "informasi belum tercatat di kartu".
- Format jawaban: 1–4 kalimat ringkas, lalu daftar bullet jika ada beberapa fakta.
- Jangan ulangi pertanyaan pengguna.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function askAssistant(args: {
  question: string;
  contextBlock: string;
}): Promise<{ answer: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `KONTEKS:\n${args.contextBlock}\n\nPERTANYAAN: ${args.question}`,
      },
    ],
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
