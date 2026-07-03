"use client";

import { useAssistant } from "@/components/chat/AssistantProvider";

/**
 * /brief entry point into the portfolio (cross-project) assistant — Phase 3
 * Task 5. Mirrors RoomAssistantButton's pattern exactly (seed a real opening
 * question via `openAndAsk`, which both opens the dock and runs it), just
 * with a portfolio-flavored prompt instead of a room-scoped one. The dock
 * mounted on /brief (see project/[slug]-style layout wiring) has no
 * `projectId`, so ChatDock's portfolio branch calls `/api/assistant/message`
 * without one — the route's own portfolio branch answers from PORTFOLIO
 * KONTEKS (retrieval.ts's buildPortfolioContextBlock), not any single
 * project's cards.
 */
const OPENING_PROMPT =
  "Apa yang paling butuh perhatian saya hari ini di semua proyek? " +
  "Proyek mana yang paling berisiko, dan apa 3 hal terpenting yang harus saya putuskan atau tindak lanjuti sekarang?";

export function PortfolioAssistantButton() {
  const { openAndAsk } = useAssistant();
  function open() {
    openAndAsk(OPENING_PROMPT);
  }
  return (
    <button
      type="button"
      onClick={open}
      className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] md:min-h-0"
    >
      Tanya asisten portofolio
    </button>
  );
}
