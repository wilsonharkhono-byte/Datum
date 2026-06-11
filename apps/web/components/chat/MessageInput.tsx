"use client";
import { useState, useRef } from "react";
import { PaperclipIcon } from "@/components/icons/Icon";

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
    <form onSubmit={submit}>
      <div className="flex gap-2 px-4 py-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="input-strong flex-1"
        />
        {acceptFiles ? (
          <label
            aria-label="Lampirkan foto atau PDF"
            className="flex cursor-pointer items-center rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--sand-dark)] hover:text-[var(--sand-dark)]"
          >
            <PaperclipIcon size={14} />
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
          className="rounded bg-foreground px-4 py-1.5 text-xs font-semibold text-white disabled:bg-[var(--text-muted)]"
        >
          Kirim
        </button>
      </div>
      {file ? (
        <div className="flex items-center gap-1.5 border-t border-[var(--border)] bg-[var(--surface-alt)] px-4 py-1 text-[10px] text-[var(--text-secondary)]">
          <PaperclipIcon size={11} /> {file.name} ({Math.round(file.size / 1024)} KB) · <button
            type="button"
            onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
            aria-label="Hapus lampiran yang dipilih"
            className="text-red-700 hover:underline"
          >hapus</button>
        </div>
      ) : null}
    </form>
  );
}
