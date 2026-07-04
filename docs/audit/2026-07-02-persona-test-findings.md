# Persona Test Findings — Live Local Environment (2026-07-02)

**Setup:** full local Supabase stack (all migrations incl. `20260628000001/2` — their first real application, clean), pilot seed + persona supplement: `wilson` (principal), `carissa` (designer, both projects), `budi` (site_supervisor, BDG-H1 only, cost-hidden). 15 rooms / 958 seeded steps / room-named topics / realistic card mix (1 area-linked, 3 unlinked). App at deployed commit `37fb7d6` against the local stack with a real Anthropic key.

## Headline: the bridge ran live for the first time anywhere — and it works

Budi (mobile viewport) logged a `Kerja` event on the area-linked waterproofing card → `after()` fired → `[infer-card-steps] summary: claimed=2 done=2 skipped=0 failed=0` → Haiku matched **BW2 Aplikasi waterproofing membrane** (done, 0.95) and wrote the drying-wait note from the older event ("Menunggu pengeringan lapis pertama", 0.95). Steps appeared as "Berjalan" in the room panel within seconds; room last-activity bumped to "1 menit lalu". **Inference quality: genuinely good.** Tanya (via the room button) produced a PM-grade answer weaving the 3-minute-old 80% progress, the gate target, lead-time-ordered procurement, and the granit decision from a different card.

## Bugs found ONLY by the live run

| # | Severity | Finding |
|---|---|---|
| B1 | **Critical** | `applyStepInference` does not propagate the card event's `occurred_at` — AI step events are stamped at *processing* time. Batch-processing an older event after a newer one **overrides the newer state** (observed: BW2 ended `in_progress` although the newest card event said done/100%). Fix: pass the card event's `occurred_at` through. |
| B2 | Important | Prompt eagerness: "siap flood test **besok**" → BW3 marked `in_progress` (0.90) though it hasn't started. Prompt needs a rule: report only work that HAS happened; future intentions ≠ progress. |
| B3 | Important | Room stage chip says "**Gate H · Serah Terima**" while the room's only activity is gate-B waterproofing — a trust-killer label. Stage derivation misfires when gate statuses are `not_started` (stale, pending recompute). |
| B4 | Important | Gate cells go stale on event insert but wait for a **manual** "Hitung ulang readiness" click (observed: "8 stale" on /brief). Recompute should self-heal (auto after event / cron). |
| B5 | Important | `/risiko` contradiction on one row: level "**Aman**" (signals-derived — signals can't fire without planned dates) next to "**+34 hari dari target**" (forecast-derived). Two vocabularies disagree in a single sentence. |

## UX findings by persona

**Budi (field supervisor, mobile):**
- RLS isolation correct: sees exactly 1 project; PKW invisible. Landing still offers "+ BUAT PROYEK" to a supervisor (role-inappropriate affordance, minor).
- **Catatan = 1 required field; Kerja = 11 fields.** The default path is the note — which is exactly the prod behavior (89 notes vs 1 work/mo). Confirms Phase 1's kind-agnostic inference as the fix (don't retrain the team; read their notes).
- AI updates show **no attribution** (nothing marks them AI; author blank) and no link to the originating card. Skips (`no_candidate_steps`) invisible.
- Room panel: "Perlu keputusan:" renders a **21-step run-on blob** (unreadable on mobile); each room exposes 61 steps ("Lihat semua langkah (61)") — needs top-N focus, not taxonomy.
- Assistant dock + seeded room prompt work well on mobile.

**Carissa (studio designer, desktop):**
- Sees both her projects; board/card flow smooth.
- Decision timeline row rendered "**undefined —**" for a payload-shape variant (renderer not tolerant; should degrade to question text).
- "Tandai diputuskan" is one click and works (payload status → `decided`) — but **never asks what was decided**; the outcome is unrecorded (and unavailable to AI/learning later).
- High-risk kinds (decision/work/vendor) insert directly — the draft/review gate is dead code, as the code audit found.

**Wilson (principal, desktop):**
- `/brief` structure is right and empty states are honest/educational. But "HARI INI — PRIORITAS" is dominated by stale-card noise ("Tanpa aktivitas 20 bulan" from old imports) while **today's real pulse (waterproofing at 80%, flood test tomorrow) appears nowhere**. No forecast, no AI activity, no step progress on the brief.
- `/risiko` renders forecast (`+34 hari`) — see B5 contradiction.

## Implications folded into the build

1. Phase 1 must ship B1 + B2 with the kind-agnostic claim (same code area).
2. Phase 2 must ship B3, B4, B5, attribution/confirm loop, decision-outcome capture, blob truncation, renderer tolerance.
3. The Tanya answer proves Phase 3's premise: model quality is sufficient; the gap is context supply + memory + delivery.
