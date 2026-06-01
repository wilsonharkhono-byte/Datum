"use client";
import { useState, useRef } from "react";

export function MessageInput({
  onSend,
  disabled,
  placeholder = "Tanya atau cari di kartu…",
  acceptFiles = false,
}: {
  onSend: (q: string, file: File | null) => void;
  disabled: boolean;
  placeholder?: string;
  acceptFiles?: boolean;
}) {
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if ((!v && !file) || disabled) return;
    onSend(v || (file ? `[Lampiran: ${file.name}]` : ""), file);
    setValue("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form onSubmit={submit} className="border-t border-stone-200 bg-white">
      <div className="flex gap-2 px-4 py-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 rounded border border-stone-300 px-3 py-1.5 text-sm focus:border-amber-700 focus:outline-none"
        />
        {acceptFiles ? (
          <label
            className="flex cursor-pointer items-center rounded border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-amber-700 hover:text-amber-700"
            title="Lampirkan foto atau PDF"
          >
            📎
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              disabled={disabled}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
        ) : null}
        <button
          type="submit"
          disabled={disabled || (value.trim().length === 0 && !file)}
          className="rounded bg-stone-900 px-4 py-1.5 text-xs font-semibold text-white disabled:bg-stone-400"
        >
          Kirim
        </button>
      </div>
      {file ? (
        <div className="border-t border-stone-200 bg-stone-50 px-4 py-1 text-[10px] text-stone-600">
          📎 {file.name} ({Math.round(file.size / 1024)} KB) · <button
            type="button"
            onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
            className="text-red-700 hover:underline"
          >hapus</button>
        </div>
      ) : null}
    </form>
  );
}
