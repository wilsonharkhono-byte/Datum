import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUnreadCount } from "@/lib/notifications/queries";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const count = await getUnreadCount(supabase).catch(() => 0);
  return NextResponse.json({ count });
}
