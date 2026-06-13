// Pure helpers for the CATAT capture flow. No server/runtime deps so they are
// unit-testable in the node vitest environment.

/**
 * Trello-import template/guide placeholder cards. Their titles start with
 * "GUIDE …" (the upload-instructions card) or the literal "YYYY-MM-DD …"
 * naming-convention stub. These are inactive-by-design slots, never real work.
 * A real card whose title starts with an actual date ("2025 01 20 - …") does
 * NOT match. Single source of truth — also used by the advisor stale-card feed.
 */
const TEMPLATE_TITLE = /^(guide\b|yyyy-mm-dd)/i;

export function isTemplateCardTitle(title: string | null | undefined): boolean {
  return TEMPLATE_TITLE.test((title ?? "").trim());
}

const LABEL_FIELDS = [
  "request_text", // client_request
  "description",  // work / drawing
  "topic",        // decision
  "item",         // material
  "body",         // note
  "caption",      // photo
  "title",        // document
  "vendor_name",  // vendor
] as const;

const MAX_LABEL = 80;

/**
 * Best descriptive label for a new card created from a captured note, WITHOUT a
 * date prefix (the caller prepends the date). Order: AI suggestion → primary
 * payload text field → the user's raw note. Whitespace is collapsed and the
 * result is truncated to MAX_LABEL chars (ellipsis appended when cut).
 */
export function deriveCardLabel(
  suggested: unknown,
  payload: Record<string, unknown>,
  rawText: string,
): string {
  const candidates: unknown[] = [
    suggested,
    ...LABEL_FIELDS.map((f) => payload[f]),
    rawText,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = c.trim().replace(/\s+/g, " ");
    if (t.length === 0) continue;
    return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL)}…` : t;
  }
  return "Catatan";
}
