/**
 * Pure: turn one card_event's AI-inference outcome (ai_step_status/ai_step_error
 * + the step names the AI wrote, if any) into the subtle one-line result shown
 * under the event row on the card timeline — or null to render nothing.
 *
 * Closes the card-side feedback loop from Task 1/3 (the AI silently updates
 * steps or skips in the background) — a user logging an event should be able
 * to tell, right there on the card, whether it landed.
 *
 * Status/error vocabulary matches the outbox columns added in
 * packages/db/supabase/migrations/20260628000002_card_step_inference.sql and
 * written by apps/web/lib/steps/run-inference.ts:
 *   - status: 'pending' | 'processing' | 'done' | 'failed' | 'skipped'
 *   - error (only set for 'skipped'/'failed'): 'no_candidate_steps' | 'not_progress' | 'no_text' | <message>
 *
 * Rendering rules (see docs/superpowers/plans/2026-07-02-launch-phase02.md Task 4):
 *   - done + step names available     -> "AI: memperbarui langkah {names}"
 *   - done + no_confident_match       -> "AI: membaca progres, tapi belum yakin langkah mana — periksa manual"
 *     (is_progress was true but zero matches cleared the confidence bar — see run-inference.ts)
 *   - done, no names, no error        -> null (nothing to attribute; avoids a bare "AI: memperbarui langkah")
 *   - skipped/no_candidate_steps      -> "AI: kartu belum tertaut ke ruangan — tautkan agar progres terbaca"
 *   - skipped/not_progress            -> null (silence is correct: the event just wasn't step-relevant)
 *   - skipped/no_text                 -> null (same: nothing to read)
 *   - failed                          -> "AI: gagal membaca — akan dicoba lagi"
 *   - pending/processing/other        -> null (no subtle "membaca…" line — see task-4-report.md for why)
 */
export function aiResultLine(
  status: string | null | undefined,
  error: string | null | undefined,
  stepNames: string[],
): string | null {
  switch (status) {
    case "done":
      if (stepNames.length > 0) return `AI: memperbarui langkah ${stepNames.join(", ")}`;
      if (error === "no_confident_match") {
        return "AI: membaca progres, tapi belum yakin langkah mana — periksa manual";
      }
      return null;
    case "skipped":
      if (error === "no_candidate_steps") {
        return "AI: kartu belum tertaut ke ruangan — tautkan agar progres terbaca";
      }
      // 'not_progress' | 'no_text' | anything else unrecognized: silence is correct.
      return null;
    case "failed":
      return "AI: gagal membaca — akan dicoba lagi";
    default:
      // 'pending' | 'processing' | null/undefined (pre-migration rows, non-work events): nothing.
      return null;
  }
}

/**
 * True for exactly the "AI: kartu belum tertaut ke ruangan…" case aiResultLine emits —
 * the one result line the card page renders as a link (to the Areas Terkait section,
 * so the hint doubles as the fix). Kept as its own predicate (rather than string-matching
 * the rendered line) so the component doesn't need to parse aiResultLine's copy.
 */
export function isUnlinkedCardHint(status: string | null | undefined, error: string | null | undefined): boolean {
  return status === "skipped" && error === "no_candidate_steps";
}
