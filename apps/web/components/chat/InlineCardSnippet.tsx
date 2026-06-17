"use client";
import { useEffect, useState } from "react";

function extractUrls(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const urlRe = /(https?:\/\/[^\s"'<>)]+)/g;
  for (const v of Object.values(payload)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(urlRe)) urls.push(m[1]!);
  }
  return [...new Set(urls)]; // dedup
}

type Snippet = {
  card: { id: string; title: string; slug: string; current_summary: string | null };
  topicName: string;
  events: { id: string; event_kind: string; occurred_at: string; payload: Record<string, unknown> }[];
};

export function InlineCardSnippet({ cardId, eventIds }: { cardId: string; eventIds: string[] }) {
  const [snippet, setSnippet] = useState<Snippet | null>(null);
  useEffect(() => {
    fetch(`/api/assistant/snippet?cardId=${cardId}&eventIds=${eventIds.join(",")}`)
      .then((r) => r.ok ? r.json() : null).then(setSnippet)
      .catch(() => setSnippet(null));
  }, [cardId, eventIds.join(",")]);

  if (!snippet) return null;
  return (
    <div className="max-w-[80%] rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs">
      <div className="mb-1 font-semibold text-foreground">
        {snippet.card.title} <span className="font-normal text-[var(--text-muted)]">· {snippet.topicName}</span>
      </div>
      <ul className="space-y-0.5">
        {snippet.events.map((e) => {
          const p = e.payload as Record<string, unknown>;
          const urls = extractUrls(p);
          const firstText = (["body", "description", "request_text", "topic", "what", "title", "notes"] as const)
            .map((k) => typeof p[k] === "string" ? p[k] as string : null)
            .filter((s): s is string => s != null && s.length > 0)[0] ?? JSON.stringify(p);
          return (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="shrink-0 text-[10px] uppercase text-[var(--sand-dark)]">{e.event_kind}</span>
              <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                {new Date(e.occurred_at).toLocaleDateString("id-ID", { month: "short", day: "numeric" })}
              </span>
              <span className="min-w-0 flex-1 break-words text-[var(--foreground)]">{firstText.slice(0, 80)}</span>
              {urls.length > 0 ? (
                <a
                  href={urls[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded bg-[var(--surface-alt)] px-1.5 text-[10px] text-[var(--sand-dark)] hover:underline"
                  aria-label={`Buka ${urls[0]}`}
                >
                  🔗
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
