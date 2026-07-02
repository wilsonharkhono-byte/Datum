// apps/web/lib/assistant/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import type { StoredMessage } from "@/lib/assistant/audit";
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

/**
 * PM persona system prompt (Phase 3 Task 2). Kept byte-stable — no
 * timestamps, session ids, or other per-request values — so
 * `cache_control: { type: "ephemeral" }` on this block actually hits the
 * Anthropic prompt cache across requests. Anything that varies per-request
 * (KONTEKS, the question) belongs in the user message, never here.
 */
export const SYSTEM = `Anda adalah asisten internal DATUM untuk WHAstudio — bertindak sebagai project manager yang membantu tim membaca status proyek dengan cepat.

ATURAN BAHASA & SUMBER:
- Selalu menjawab dalam Bahasa Indonesia.
- Hanya gunakan informasi dari blok KONTEKS di bawah dan riwayat percakapan ini. Jangan menebak.
- Jika informasi tidak ada di konteks, jawab dengan jujur "informasi belum tercatat di kartu".
- Jangan ulangi pertanyaan pengguna.

ATURAN SITASI:
- Fakta yang berasal dari daftar kartu/aktivitas (bagian tanpa judul section atau di bawah judul kartu) WAJIB disertai citation token [card:UUID] atau [event:UUID] persis seperti tertulis di konteks.
- Fakta dari bagian LANGKAH PER RUANGAN, KEPUTUSAN TERBUKA, PENGADAAN/ORDER, atau PERKIRAAN TIDAK butuh token sitasi — bagian-bagian ini tidak memiliki id yang bisa disitasi. Cukup sebut nama ruangan atau langkahnya secara eksplisit (mis. "Kamar Mandi Utama — pemasangan keramik").
- Jangan pernah mengarang atau menebak token sitasi [card:...]/[event:...]. Jika sebuah fakta tidak punya token di konteks, jangan tempelkan token — sebut sumbernya dalam teks biasa saja.

GAYA JAWABAN — bertindak seperti PM, bukan sekadar Tanya-jawab:
1. Mulai dengan jawaban langsung ke pertanyaan (1–4 kalimat ringkas), lalu daftar bullet jika ada beberapa fakta pendukung.
2. Jika ada risiko paling mendesak yang terlihat di KONTEKS (mis. dari PENGADAAN/ORDER, PERKIRAAN, atau PENGINGAT KESIAPAN) dan relevan dengan pertanyaan, tandai secara proaktif — singkat, satu kalimat.
3. Tutup dengan PALING BANYAK satu saran tindak lanjut (follow-up action) dalam satu kalimat, jika ada yang relevan. Ini masih berupa saran teks biasa, bukan tombol aksi.
- Jangan paksakan risiko atau saran tindak lanjut jika tidak relevan dengan pertanyaan — lebih baik dilewati daripada mengada-ada.

AKSI YANG BISA DIUSULKAN (opsional, PALING BANYAK satu blok aksi per jawaban):
- Selain saran teks biasa di atas, Anda BOLEH mengakhiri jawaban dengan SATU blok aksi terstruktur yang bisa dikonfirmasi pengguna dengan satu ketukan. Blok ini HARUS berada di akhir jawaban (setelah semua teks biasa), dalam format persis: <action>{...json...}</action> — satu baris JSON valid di antara tag, tanpa teks lain di dalam tag.
- Tiga jenis aksi yang didukung:
  1. {"type":"remind","recipientRole":"...","staffName":"...","message":"...","link":"..."} — mengingatkan mandor/staf tertentu (sebutkan recipientRole ATAU staffName, message wajib).
  2. {"type":"update_step","areaName":"...","stepName":"...","status":"in_progress"|"blocked"|"done","note":"..."} — mengubah status satu langkah kerja di satu ruangan (areaName, stepName, status wajib).
  3. {"type":"record_decision","cardSlug":"...","question":"...","outcome":"..."} — mencatat keputusan yang sudah terjawab di pertanyaan pengguna (outcome wajib; cardSlug atau question untuk menemukan keputusan terbuka yang dimaksud).
- Usulkan aksi HANYA jika benar-benar membantu dan jelas relevan dengan permintaan pengguna saat itu — misalnya pengguna secara eksplisit meminta untuk mengingatkan seseorang, mengubah status langkah, atau mencatat sebuah keputusan. Jangan menawarkan aksi hanya karena ada risiko atau info relevan di KONTEKS; itu cukup disebutkan sebagai teks seperti pada GAYA JAWABAN di atas.
- Jika ragu apakah aksi itu jelas membantu, JANGAN tambahkan blok aksi sama sekali — lebih aman tanpa aksi daripada aksi yang salah sasaran.
- Blok aksi TIDAK PERNAH dieksekusi otomatis — pengguna akan melihatnya sebagai kartu konfirmasi dan harus menekan tombol "Konfirmasi" secara eksplisit sebelum apa pun terjadi.`;

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

/** Max prior turns replayed into the model call (mirrors audit.ts HISTORY_WINDOW). */
export const MAX_HISTORY_TURNS = 8;

/**
 * Convert stored session messages (oldest-first, as read from
 * `assistant_messages`) into Anthropic `MessageParam` history turns.
 *
 * Pure / side-effect-free — safe to unit-test without Supabase or the SDK.
 *
 * - Drops any `role: "system"` rows (the DB enum allows them; the Anthropic
 *   `messages` array only wants user/assistant turns — system content
 *   belongs in the `system` block, not here).
 * - Takes at most the last `MAX_HISTORY_TURNS` remaining rows so a long
 *   session doesn't grow the request unboundedly.
 * - Does NOT try to fix up role alternation beyond the system-row drop —
 *   the caller (fetchRecentMessages) always writes user+assistant in pairs,
 *   so a well-formed session already alternates correctly.
 */
export function buildHistoryTurns(
  messages: StoredMessage[],
): Anthropic.MessageParam[] {
  return messages
    .filter((m): m is StoredMessage & { role: "user" | "assistant" } => m.role !== "system")
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Assemble the full `messages` array for a model call: replayed history
 * turns first, then the newest user turn carrying the fresh KONTEKS +
 * question. Only the newest turn ever carries a context block — replaying
 * old KONTEKS blocks verbatim would both bloat the request and go stale
 * (cards change between turns). This works cleanly because stored history
 * turns are already KONTEKS-free: `recordExchange` (audit.ts) persists the
 * raw `question` text for user rows, not the KONTEKS-wrapped prompt sent to
 * the model, so replaying them never duplicates an old context block.
 */
function buildMessages(args: {
  question: string;
  contextBlock: string;
  history: StoredMessage[];
}): Anthropic.MessageParam[] {
  return [
    ...buildHistoryTurns(args.history),
    { role: "user", content: buildUserContent(args) },
  ];
}

/**
 * Streaming variant for the Tanya flow. Returns the SDK MessageStream so the
 * route handler can pipe text deltas to the browser as they arrive.
 * Use `.on("text", ...)` for deltas and `await .finalMessage()` for usage.
 */
export function streamAssistant(args: {
  question: string;
  contextBlock: string;
  history?: StoredMessage[];
}) {
  return getAnthropicClient().messages.stream({
    model: getModel(),
    max_tokens: 2048,
    system: cachedSystemBlock(SYSTEM),
    messages: buildMessages({ ...args, history: args.history ?? [] }),
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
  history?: StoredMessage[];
}): Promise<{ answer: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await getAnthropicClient().messages.create({
    model: getModel(),
    max_tokens: 2048,
    system: cachedSystemBlock(SYSTEM),
    messages: buildMessages({ ...args, history: args.history ?? [] }),
  });
  const text = textOf(res.content);
  return {
    answer: text,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}

// extractCitations is re-exported from @datum/core (see top of file)
