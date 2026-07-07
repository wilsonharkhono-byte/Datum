import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRecentNotifications } from "@/lib/notifications/queries";
import { NotificationList } from "@/components/notifications/NotificationList";

export default async function NotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const items = await getRecentNotifications(supabase);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Beranda</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">Notifikasi</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        @mention di komentar, aktivitas di kartu yang Anda tonton, dan status draft.
      </p>
      <div className="mt-6">
        <NotificationList items={items} />
      </div>
    </div>
  );
}
