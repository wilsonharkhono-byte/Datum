import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUnreadCount } from "@/lib/notifications/queries";

export async function NotificationBadge() {
  const supabase = await createSupabaseServerClient();
  const count = await getUnreadCount(supabase).catch(() => 0);
  return (
    <Link
      href="/notifications"
      className="relative inline-flex items-center rounded border border-[#B5AFA8] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#524E49] hover:border-[#7A6B56]"
      title="Notifikasi"
    >
      🔔
      {count > 0 ? (
        <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
