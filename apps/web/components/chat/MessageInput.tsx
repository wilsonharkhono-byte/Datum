"use client";
import { useState } from "react";

export function MessageInput({ onSend, disabled }: { onSend: (q: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v || disabled) return;
    onSend(v);
    setValue("");
  }
  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-stone-200 bg-white px-4 py-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Tanya atau cari di kartu…"
        className="flex-1 rounded border border-stone-300 px-3 py-1.5 text-sm focus:border-amber-700 focus:outline-none"
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="rounded bg-stone-900 px-4 py-1.5 text-xs font-semibold text-white disabled:bg-stone-400"
      >
        Kirim
      </button>
    </form>
  );
}
