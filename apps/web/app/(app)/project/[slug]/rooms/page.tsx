import Link from "next/link";
import { getProjectRooms } from "@/lib/rooms/queries";
import { RoomsView } from "@/components/rooms/RoomsView";

export default async function ProjectRoomsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // RLS-enforced (getProjectRooms uses the session client). Returns null when
  // the project_code does not resolve OR the caller cannot see it — both
  // collapse to the same not-found branch, mirroring the schedule page.
  const data = await getProjectRooms(slug);
  if (!data) {
    return (
      <div className="p-6 text-red-700">
        Proyek tidak ditemukan: <code>{slug}</code>
        <div className="mt-3">
          <Link href="/" className="underline">
            ← kembali
          </Link>
        </div>
      </div>
    );
  }

  return <RoomsView data={data} now={Date.now()} />;
}
