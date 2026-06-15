import Link from "next/link";
import type { ProjectRooms } from "@/lib/rooms/queries";
import { RoomRow } from "./RoomRow";

/**
 * The "Ruangan" surface: one row per area, sorted by urgency, as the primary
 * daily glance for a project. Read-only. `now` is passed from the server
 * component so relative times render deterministically per request.
 */
export function RoomsView({ data, now }: { data: ProjectRooms; now: number }) {
  const count = data.rooms.length;

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-3">
        <Link
          href={`/project/${data.projectCode}`}
          className="text-xs text-[var(--text-muted)] hover:underline"
        >
          ← {data.projectCode} Board
        </Link>
      </div>

      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">Ruangan</p>
        <h1 className="text-2xl font-semibold text-[#141210]">{data.projectName}</h1>
        <p className="mt-1 text-sm text-[#524E49]">
          {count > 0 ? (
            <>
              {count} ruangan ·{" "}
              <Link
                href={`/project/${data.projectCode}/schedule`}
                className="font-medium text-[#7A6B56] underline hover:text-[#3a3527]"
              >
                Lihat matrix detail →
              </Link>
            </>
          ) : (
            "Belum ada ruangan"
          )}
        </p>
      </header>

      {count === 0 ? <EmptyState projectCode={data.projectCode} /> : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          {data.rooms.map((room) => (
            <RoomRow key={room.areaId} room={room} projectCode={data.projectCode} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ projectCode }: { projectCode: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[#FDFAF6] p-6 text-sm text-[#524E49]">
      <p className="font-medium text-[#141210]">Proyek ini belum punya ruangan.</p>
      <p className="mt-2">
        Ruangan dibuat dari area proyek. Tambahkan area secara manual, atau jalankan
        {" "}
        <span className="font-medium">&quot;Deteksi ruangan otomatis&quot;</span> untuk membaca nama
        ruangan dari judul kartu.
      </p>
      <Link
        href={`/project/${projectCode}/settings?tab=areas`}
        className="mt-3 inline-flex min-h-11 items-center rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)] hover:text-[var(--foreground)]"
      >
        Buka Pengaturan → Areas
      </Link>
    </div>
  );
}
