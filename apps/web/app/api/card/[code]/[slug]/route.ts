import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardWithTimelineByProjectCode, getCardComments, getCardMembers } from "@/lib/cards/queries";

export type CardPayload = Awaited<ReturnType<typeof getCardWithTimelineByProjectCode>> & {
  comments: Awaited<ReturnType<typeof getCardComments>>;
  members: Awaited<ReturnType<typeof getCardMembers>>;
};

export async function GET(_req: Request, { params }: { params: Promise<{ code: string; slug: string }> }) {
  const { code, slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let detail;
  try {
    detail = await getCardWithTimelineByProjectCode(supabase, code.toUpperCase(), slug);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
  try {
    const [comments, members] = await Promise.all([
      getCardComments(supabase, detail.card.id),
      getCardMembers(supabase, detail.card.id),
    ]);
    return NextResponse.json({ ...detail, comments, members } satisfies CardPayload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
