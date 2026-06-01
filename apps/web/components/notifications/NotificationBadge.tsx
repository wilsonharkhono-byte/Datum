import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUnreadCount } from "@/lib/notifications/queries";
import { NotificationBadgeClient } from "./NotificationBadgeClient";

export async function NotificationBadge() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const initialCount = user ? await getUnreadCount(supabase).catch(() => 0) : 0;
  return <NotificationBadgeClient staffId={user?.id ?? null} initialCount={initialCount} />;
}
