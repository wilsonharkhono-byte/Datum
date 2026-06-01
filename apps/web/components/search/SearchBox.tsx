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
        className="flex-1 rounded border border-[#B5AFA8] bg-white px-3 py-1.5 text-sm focus:border-amber-700 focus:outline-none"
        minLength={2}
      />
      <button
        type="submit"
        className="rounded bg-[#141210] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#FDFAF6] hover:bg-[#3a3527]"
      >
        Cari
      </button>
    </form>
  );
}
