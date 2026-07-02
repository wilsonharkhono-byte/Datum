/**
 * Pure event-render helpers — shared between web (EventRow.tsx) and mobile
 * (EventRow native component). No DOM, no React, no Next.js — safe to import
 * anywhere.
 *
 * `summarize` produces the one-liner text for a card_events row.
 * `extractUrls` pulls URLs from a payload object.
 * `looksLikeImage` checks a URL's extension.
 * `safeHostname` safely parses a URL's hostname.
 * `valueLabel` converts raw enum values to Bahasa Indonesia display strings.
 */

import type { CardEvent } from "@datum/db";

/** Bahasa Indonesia labels for well-known enum payload values (statuses, actors). */
const VALUE_LABELS: Record<string, string> = {
  needs_decision:  "Butuh keputusan",
  decided:         "Sudah diputuskan",
  superseded:      "Digantikan",
  open:            "Terbuka",
  answered:        "Terjawab",
  assigned:        "Ditugaskan",
  in_progress:     "Dikerjakan",
  blocked:         "Terblokir",
  done:            "Selesai",
  specified:       "Spesifikasi dibuat",
  sample_approved: "Sampel disetujui",
  ordered:         "Dipesan",
  delivered:       "Terkirim",
  quote:           "Penawaran",
  pick:            "Dipilih",
  contract:        "Kontrak",
  survey:          "Survei",
  defect:          "Defect",
  client:          "Klien",
  principal:       "Prinsipal",
  pic:             "PIC",
  contractor:      "Kontraktor",
  architect:       "Arsitek",
  vendor:          "Vendor",
};

/** Convert a raw enum string to its Bahasa Indonesia display label.
 *  Falls back to the raw value if no mapping exists. */
export function valueLabel(v: string): string {
  return VALUE_LABELS[v] ?? v;
}

/** Extract all unique HTTP(S) URLs from the string values of a payload object. */
export function extractUrls(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const urlRe = /(https?:\/\/[^\s"'<>)]+)/g;
  for (const v of Object.values(payload)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(urlRe)) urls.push(m[1]!);
  }
  return [...new Set(urls)]; // dedup
}

/** True if the URL looks like a raster or HEIC image by extension. */
export function looksLikeImage(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|$)/i.test(url);
}

/** Return the hostname of a URL, or a truncated fallback for malformed input. */
export function safeHostname(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u.slice(0, 30) + "…";
  }
}

/**
 * Renderer-tolerance helper: return the first non-empty string value among
 * `keys` on `payload`, or null if none match. Used so the timeline never
 * prints the literal "undefined" — a malformed/legacy payload missing its
 * primary field (e.g. a decision with no `topic`) used to render
 * `String(undefined)` verbatim ("undefined — ..."). Callers fall back through
 * a small chain of plausible fields (question → summary → body →
 * description) before giving up.
 */
export function textField(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/** Produce the one-liner summary text for a card event row.
 *  Covers all current and retired event kinds; retired kinds fall through
 *  to their historical display string so old timelines render correctly. */
export function summarize(ev: CardEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.event_kind) {
    case "decision": {
      // topic is the primary field, but malformed/legacy payloads can miss
      // it — fall back through question → summary → body → description
      // rather than ever printing "undefined". The spec half is already
      // optional-safe (proposed_spec ?? current_spec ?? "").
      const topic = textField(p, ["topic", "question", "summary", "body", "description"]);
      const spec = textField(p, ["proposed_spec", "current_spec"]);
      if (topic === null) return spec ?? "";
      return spec ? `${topic} — ${spec}` : topic;
    }
    case "drawing":
      return String(p.description ?? p.drawing_code ?? "");
    case "vendor": {
      const verb =
        p.interaction === "quote"    ? "Quote dari"
        : p.interaction === "pick"    ? "Pilih"
        : p.interaction === "survey"  ? "Survei oleh"
        : p.interaction === "contract"? "Kontrak dengan"
        : "Interaksi";
      const amount =
        typeof p.amount === "number"
          ? ` · Rp ${p.amount.toLocaleString("id-ID")}`
          : "";
      return `${verb} ${p.vendor_name ?? ""}${amount}`;
    }
    case "material":
      return `${String(p.item)} — ${valueLabel(String(p.status))}`;
    case "work": {
      const status = valueLabel((p.status as string) ?? "?");
      const who =
        typeof p.worker_name === "string" && p.worker_name.length > 0
          ? `${p.worker_name} · `
          : "";
      const desc =
        typeof p.description === "string"
          ? p.description
          : typeof p.scope === "string"
          ? p.scope
          : "";
      const pct =
        typeof p.percent_complete === "number"
          ? ` (${p.percent_complete}%)`
          : "";
      return `${who}${status}${pct}${desc ? " — " + desc : ""}`;
    }
    case "photo":
      return String(p.caption ?? "(foto)");
    case "document":
      return textField(p, ["title", "description", "summary", "body"]) ?? "";
    case "client_request":
      return textField(p, ["request_text", "question", "summary", "body", "description"]) ?? "";
    case "note":
      return textField(p, ["body", "summary", "description"]) ?? "";
    // Retired kinds — kept for historical event display
    case "survey":
      return [p.vendor_name, p.location]
        .filter(Boolean)
        .map(String)
        .join(" · ");
    case "vendor_quote":
      return `${String(p.vendor_name)} · Rp ${(p.amount as number).toLocaleString("id-ID")}`;
    case "vendor_pick":
      return String(p.vendor_name);
    case "worker_assigned":
      return `${String(p.worker_name)}${p.scope ? ` — ${String(p.scope)}` : ""}`;
    case "progress":
      return `${String(p.status)}${p.percent_complete != null ? ` (${String(p.percent_complete)}%)` : ""}`;
    case "defect":
      return `${String(p.severity)} · ${String(p.description)}`;
    case "pending":
      return String(p.what);
    default:
      return JSON.stringify(p);
  }
}
