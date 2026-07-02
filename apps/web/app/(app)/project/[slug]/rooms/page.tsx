import Link from "next/link";
import { getProjectRooms } from "@/lib/rooms/queries";
import { getRoomStepViews, getAreaStepEvents } from "@/lib/steps/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  const supabase = await createSupabaseServerClient();
  const stepViews = await getRoomStepViews(
    supabase,
    data.projectId,
    data.rooms.map((r) => ({ areaId: r.areaId, areaType: r.areaType })),
  );

  // One batched fetch for step history (incl. AI attribution) across every
  // room's steps — same shape as the per-area helper, just fed all step ids
  // up front so the page issues a single extra round-trip regardless of room
  // count (mirrors getRoomStepViews' fixed-round-trip pattern above).
  const allStepIds = [...stepViews.values()].flatMap((v) => v.steps.map((s) => s.id));
  const stepEvents = await getAreaStepEvents(supabase, allStepIds);

  return <RoomsView data={data} now={Date.now()} stepViews={stepViews} stepEvents={stepEvents} />;
}
