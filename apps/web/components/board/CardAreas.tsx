"use client";
import { useState, useTransition } from "react";
import type { Area } from "@datum/db";
import { XIcon } from "@/components/icons/Icon";
import {
  linkCardToArea,
  unlinkCardFromArea,
} from "@/lib/cards/area-link-mutations";

export function CardAreas({
  cardId,
  projectCode,
  cardSlug,
  currentAreas,
  allProjectAreas,
}: {
  cardId: string;
  projectCode: string;
  cardSlug: string;
  currentAreas: Area[];
  allProjectAreas: Area[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const linkedIds = new Set(currentAreas.map((a) => a.id));
  const addable = allProjectAreas.filter((a) => !linkedIds.has(a.id));

  function add(areaId: string) {
    if (!areaId) return;
    setError(null);
    const fd = new FormData();
    fd.set("cardId", cardId);
    fd.set("areaId", areaId);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await linkCardToArea(fd);
      if (!res.ok) setError(res.error);
    });
  }

  function remove(areaId: string) {
    setError(null);
    const fd = new FormData();
    fd.set("cardId", cardId);
    fd.set("areaId", areaId);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await unlinkCardFromArea(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {currentAreas.length === 0 ? (
        <p className="text-[11px] italic text-[var(--text-muted)]">
          Belum ada area terkait. Pilih area di bawah agar kartu ini menggerakkan
          matrix Gate × Area.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {currentAreas.map((a) => (
            <li key={a.id}>
              <span className="inline-flex items-center gap-1 rounded bg-[var(--sand-tint)] px-2 py-1 text-[11px] text-[var(--sand-dark)]">
                <span>
                  {a.area_code} &middot; {a.area_name}
                  {a.floor ? (
                    <span className="ml-1 text-[10px] opacity-70">
                      ({a.floor})
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  disabled={pending}
                  aria-label={`Lepas tautan area ${a.area_code}`}
                  title="Lepas tautan area"
                  className="flex h-3.5 w-3.5 items-center justify-center rounded hover:text-red-700 disabled:opacity-50"
                >
                  <XIcon size={10} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        <select
          className="select-brand-sm w-full"
          value=""
          disabled={pending || addable.length === 0}
          onChange={(e) => {
            const v = e.target.value;
            if (v) add(v);
          }}
          aria-label="Tambah area terkait"
        >
          <option value="">
            {addable.length === 0
              ? "Semua area sudah terkait"
              : "+ Tambah area…"}
          </option>
          {addable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.area_code} &middot; {a.area_name}
              {a.floor ? ` (${a.floor})` : ""}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-[var(--text-muted)]">
          Area yang terkait akan dipakai mesin readiness untuk menghitung status
          gate per area.
        </p>
      </div>

      {error ? (
        <p className="text-[11px] text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
