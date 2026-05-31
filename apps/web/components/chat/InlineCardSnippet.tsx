"use client";
import { useEffect, useState } from "react";

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
    <div className="max-w-[80%] rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
      <div className="mb-1 font-semibold text-stone-900">
        {snippet.card.title} <span className="font-normal text-stone-500">· {snippet.topicName}</span>
      </div>
      <ul className="space-y-0.5">
        {snippet.events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className="w-20 text-[10px] uppercase text-amber-800">{e.event_kind}</span>
            <span className="w-16 text-[10px] text-stone-500">
              {new Date(e.occurred_at).toLocaleDateString("id-ID", { month: "short", day: "numeric" })}
            </span>
            <span className="flex-1 text-stone-800">{JSON.stringify(e.payload).slice(0, 80)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
