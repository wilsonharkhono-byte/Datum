"use client";
import { useEffect, useState } from "react";
import { gateShortName } from "@/lib/gates/labels";

type Deadline = {
  gateCode: string;
  gateName: string;
  targetStartDate: string;
  targetEndDate: string;
  areaCount: number;
};

export function NextDeadlineBadge({ cardId }: { cardId: string }) {
  const [deadline, setDeadline] = useState<Deadline | null>(null);

  useEffect(() => {
    fetch(`/api/cards/${cardId}/next-deadline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Deadline | null) => setDeadline(d))
      .catch(() => setDeadline(null));
  }, [cardId]);

  if (!deadline) return null;

  const target = new Date(deadline.targetEndDate);
  const today = new Date();
  const daysLeft = Math.floor((target.getTime() - today.getTime()) / 86400000);
  const overdue = daysLeft < 0;
  const urgent = !overdue && daysLeft <= 14;

  const tone =
    overdue
      ? "bg-[var(--flag-critical-bg)] text-[var(--flag-critical)] border-[var(--flag-critical)]"
      : urgent
        ? "bg-[var(--flag-warning-bg)] text-[var(--flag-warning)] border-[var(--flag-warning)]"
        : "bg-[var(--sand-tint)] text-[var(--sand-dark)] border-[var(--border)]";

  const label =
    overdue
      ? `Lewat target ${-daysLeft} hari`
      : daysLeft === 0
        ? "Target hari ini"
        : `Target ${daysLeft} hari lagi`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      <span aria-hidden="true">📅</span>
      <span>{deadline.gateCode} · {gateShortName(deadline.gateCode)}</span>
      <span className="opacity-70">·</span>
      <span>{label}</span>
    </span>
  );
}
