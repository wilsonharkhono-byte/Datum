import Link from "next/link";
import type { PulseProjectGroup } from "@datum/core";

/**
 * "DENYUT KEMARIN–HARI INI" — the brief's new top section. Shows what
 * actually HAPPENED in the last 48h (step + card events), grouped
 * project → room/card, so today's real progress (e.g. an 80% waterproofing
 * update) is visible instead of buried under stale advisor noise.
 */
export function PulseSection({ groups }: { groups: PulseProjectGroup[] }) {
  return (
    <section className="rounded border border-[#B5AFA8] bg-[#FDFAF6] p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">
        Denyut kemarin–hari ini
      </h2>
      {groups.length === 0 ? (
        <p className="text-xs italic text-[#524E49]">
          Belum ada aktivitas tercatat dalam 48 jam terakhir.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.projectCode} className="rounded border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7A6B56]">
                {g.projectCode} · {g.projectName}
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {g.rooms.map((room) => (
                  <li key={room.label}>
                    <p className="text-[11px] font-medium text-[#141210]">{room.label}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {room.events.map((ev) => (
                        <li key={ev.id} className="text-[11px] text-[#524E49]">
                          <Link href={ev.href} className="hover:underline">
                            {ev.detail}
                          </Link>
                          {ev.source === "ai" ? (
                            <span className="ml-1 rounded bg-[var(--flag-info-bg)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--flag-info)]">
                              Asisten AI
                              {ev.confidence != null ? ` · ${Math.round(ev.confidence * 100)}%` : ""}
                            </span>
                          ) : null}
                          {ev.cardLink ? (
                            <>
                              {" "}
                              <Link
                                href={`/project/${ev.cardLink.projectCode}/cards/${ev.cardLink.cardSlug}`}
                                className="text-[10px] text-[#7A6B56] hover:underline"
                              >
                                dari kartu →
                              </Link>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
