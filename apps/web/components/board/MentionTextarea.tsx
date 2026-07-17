"use client";
import { useRef, useState } from "react";

export type MentionCandidate = {
  id: string;
  full_name: string;
  handle: string | null;
  role: string;
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/** The @tag we insert for a candidate: their handle, else their first name. */
function tagFor(c: MentionCandidate): string {
  return c.handle ?? (c.full_name.trim().split(/\s+/)[0] ?? "");
}

/** The mention the user is mid-typing: an "@query" that ends at the caret and
    starts the string or follows whitespace. Returns the '@' position + query. */
function activeMentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = before.match(/(?:^|\s)@([a-zA-Z][a-zA-Z0-9_-]{0,30})?$/);
  if (!m) return null;
  const query = m[1] ?? "";
  return { start: caret - query.length - 1, query: query.toLowerCase() };
}

function filterCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const matches = query
    ? candidates.filter(
        (c) =>
          (c.handle ?? "").toLowerCase().startsWith(query) ||
          c.full_name.toLowerCase().includes(query),
      )
    : candidates;
  return matches.slice(0, 6);
}

/**
 * Textarea with Trello-style @mention autocomplete: typing "@" opens a
 * dropdown of people who can see this card; selecting inserts their @handle.
 * Controlled — the parent owns the value.
 */
export function MentionTextarea({
  value,
  onChange,
  candidates,
  disabled,
  rows,
  maxLength,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  candidates: MentionCandidate[];
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  // Recomputed from event handlers only (onSelect fires after every input and
  // caret move), so no effects are needed. Arrow-key navigation preventDefaults
  // the caret move, which keeps the highlight stable between keystrokes.
  function refresh() {
    const el = ref.current;
    if (!el || document.activeElement !== el) {
      setMention(null);
      return;
    }
    setMention(activeMentionQuery(el.value, el.selectionStart ?? el.value.length));
    setHighlight(0);
  }

  const matches = mention ? filterCandidates(candidates, mention.query) : [];
  const open = mention !== null && matches.length > 0;

  function select(c: MentionCandidate) {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? el.value.length;
    const tag = tagFor(c);
    const next = `${el.value.slice(0, mention.start)}@${tag} ${el.value.slice(caret)}`;
    setMention(null);
    onChange(next);
    const pos = mention.start + tag.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const chosen = matches[Math.min(highlight, matches.length - 1)];
      if (chosen) select(chosen);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSelect={refresh}
        onKeyDown={onKeyDown}
        onBlur={() => setMention(null)}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        className={className}
        aria-autocomplete="list"
      />
      {open ? (
        <ul
          role="listbox"
          aria-label="Sebut anggota proyek"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[0_8px_24px_-12px_rgba(122,107,86,0.45)]"
        >
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                // preventDefault keeps focus in the textarea so onBlur doesn't
                // close the list before the click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(c);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
                  i === highlight ? "bg-[var(--sand-tint)]" : ""
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--sand-tint)] text-[9px] font-bold text-[var(--sand-dark)]">
                  {initials(c.full_name)}
                </span>
                <span className="truncate font-medium">{c.full_name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)]">@{tagFor(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
