"use client";
import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Staff } from "@datum/db";
import { addCardMember, removeCardMember } from "@/lib/cards/mutations";
import { keys } from "@/lib/query/keys";

type StaffLite = Pick<Staff, "id" | "full_name" | "role">;
type MemberLite = { staff_id: string; role: "owner" | "watcher" | "assignee"; staff: StaffLite | null };

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function CardMembers({
  cardId,
  projectCode,
  cardSlug,
  cardCode,
  cardQuerySlug,
  members,
  candidates,
}: {
  cardId: string;
  projectCode: string;
  cardSlug: string;
  /** Canonical uppercase project_code — identity for the useCard query key. */
  cardCode: string;
  /** Canonical card slug — identity for the useCard query key. */
  cardQuerySlug: string;
  members: MemberLite[];
  candidates: StaffLite[];
}) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const memberIds = new Set(members.map((m) => m.staff_id));
  const addable = candidates.filter((c) => !memberIds.has(c.id));

  function add(staffId: string) {
    setError(null);
    const fd = new FormData();
    fd.set("cardId", cardId);
    fd.set("staffId", staffId);
    fd.set("role", "watcher");
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await addCardMember(fd);
      if (res.ok) {
        setPicking(false);
        queryClient.invalidateQueries({ queryKey: keys.card(cardCode, cardQuerySlug) });
      } else setError(res.error);
    });
  }

  function remove(m: MemberLite) {
    setError(null);
    const fd = new FormData();
    fd.set("cardId", cardId);
    fd.set("staffId", m.staff_id);
    fd.set("role", m.role);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await removeCardMember(fd);
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: keys.card(cardCode, cardQuerySlug) });
      } else setError(res.error);
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7A6B56]">Anggota:</span>
      <div className="flex flex-wrap gap-1">
        {members.length === 0 ? (
          <span className="text-[10px] italic text-[#847E78]">belum ada</span>
        ) : null}
        {members.map((m) => (
          <button
            key={`${m.staff_id}-${m.role}`}
            type="button"
            onClick={() => remove(m)}
            disabled={pending}
            title={`${m.staff?.full_name ?? "(unknown)"} — klik untuk hapus`}
            aria-label={`Hapus anggota ${m.staff?.full_name ?? "(unknown)"}`}
            className="flex items-center gap-1 rounded-full border border-[#B5AFA8] bg-white px-2 py-0.5 text-xs font-medium text-[#524E49] hover:border-red-400 hover:text-red-700"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#B29F86]/30 text-[8px] font-bold text-[#524E49]">
              {initials(m.staff?.full_name)}
            </span>
            <span>{m.staff?.full_name ?? "(unknown)"}</span>
            <span className="text-[8px] uppercase text-[var(--text-muted)]">{m.role}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          disabled={pending || addable.length === 0}
          aria-label={picking ? "Tutup pemilih anggota" : "Tambah anggota"}
          className="rounded-full border border-dashed border-[#B5AFA8] px-2 py-0.5 text-xs font-medium text-[#7A6B56] hover:border-[#7A6B56] disabled:opacity-50"
        >
          {picking ? "× tutup" : "+ tambah"}
        </button>
      </div>
      {picking ? (
        <div className="ml-2 flex flex-wrap gap-1">
          {addable.length === 0 ? (
            <span className="text-[10px] italic text-[#847E78]">semua staf sudah jadi anggota</span>
          ) : null}
          {addable.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => add(s.id)}
              disabled={pending}
              aria-label={`Tambah ${s.full_name ?? "(unknown)"} sebagai anggota`}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs font-medium text-[#141210] hover:border-[var(--sand-dark)]"
            >
              {s.full_name ?? "(unknown)"}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <span className="text-[10px] text-red-700">{error}</span> : null}
    </div>
  );
}
