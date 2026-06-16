"use client";
import { useEffect, useRef } from "react";

// Mobile-only jump bar for the board's column carousel (hidden at md+ where
// the board is a multi-column layout). One chip per visible (filtered) column,
// showing topic name + card count. Tapping a chip asks Board to scroll that
// column into view; the active chip mirrors whichever column currently fills
// the viewport (IntersectionObserver lives in Board) and keeps itself visible
// inside the strip as the user swipes.
export function BoardTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: { id: string; name: string; count: number }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  // Keep the active chip in view as the highlighted column changes.
  useEffect(() => {
    if (activeId == null) return;
    const el = chipRefs.current.get(activeId);
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeId]);

  if (tabs.length === 0) return null;

  return (
    <div
      aria-label="Lompat ke kolom"
      className="flex gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 md:hidden"
    >
      {tabs.map((tab) => {
        const on = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) chipRefs.current.set(tab.id, el);
              else chipRefs.current.delete(tab.id);
            }}
            type="button"
            onClick={() => onSelect(tab.id)}
            aria-pressed={on}
            className={`chip shrink-0${on ? " chip-on" : ""}`}
          >
            {tab.name}
            <span className="text-[10px] opacity-70">{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}
