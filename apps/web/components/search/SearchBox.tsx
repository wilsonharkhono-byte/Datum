"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SearchBox({ initialQ = "" }: { initialQ?: string }) {
  const [q, setQ] = useState(initialQ);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari kartu, aktivitas, komentar…"
        className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0"
        minLength={2}
      />
      <button
        type="submit"
        className="inline-flex min-h-11 items-center justify-center rounded bg-[var(--foreground)] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--surface)] hover:bg-[var(--sand-darker)] md:min-h-0"
      >
        Cari
      </button>
    </form>
  );
}
