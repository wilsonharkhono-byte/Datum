import Link from "next/link";
import { getProjectRooms } from "@/lib/rooms/queries";
import { getRoomStepViews, getAreaStepEventsForAreas } from "@/lib/steps/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RoomsView } from "@/components/rooms/RoomsView";

export default async function ProjectRoomsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ areaStep?: string }>;
}) {
  const { slug } = await params;
  const { areaStep } = await searchParams;

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
  // room's steps — same shape as the per-area helper, just filtered by area id
  // (not step id) so the page issues a single extra round-trip regardless of
  // room count (mirrors getRoomStepViews' fixed-round-trip pattern above)
  // without building a PostgREST URL that enumerates every step id (can be
  // hundreds+ across a project's rooms — see getAreaStepEventsForAreas' docstring).
  const areaIds = data.rooms.map((r) => r.areaId);
  const stepEvents = await getAreaStepEventsForAreas(supabase, areaIds);

  // Deep-link consume: reminders.ts's "unconfirmed block" notification links here with
  // ?areaStep=<area_step_id> (see buildUnconfirmedBlockIntents — notifications has no
  // area_step_id column, so the id rides in the link's query string instead). Resolve
  // which room owns that step server-side (stepViews is already fetched above, so this
  // is a cheap in-memory scan, not an extra round-trip) and auto-expand that room.
  const autoExpandAreaId = areaStep
    ? data.rooms.find((r) => stepViews.get(r.areaId)?.steps.some((s) => s.id === areaStep))?.areaId
    : undefined;

  return (
    <RoomsView
      data={data}
      now={Date.now()}
      stepViews={stepViews}
      stepEvents={stepEvents}
      autoExpandAreaId={autoExpandAreaId}
      autoExpandStepId={autoExpandAreaId ? areaStep : undefined}
    />
  );
}
