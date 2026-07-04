import type { ReactNode } from "react";
import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/get-current-user";
import { canManageAccess } from "@/lib/auth/require-role";
import { redirect } from "next/navigation";
import { LogoutButton } from "./logout-button";
import { NotificationBadge } from "@/components/notifications/NotificationBadge";
import { DatumWordmark } from "@/components/DatumWordmark";
import { Providers } from "@/app/providers";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  return (
    <Providers userId={staff.id}>
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
        <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-2 sm:px-8 sm:py-4">
            <div className="flex items-center gap-4">
              <div>
                <Link
                  href="/"
                  aria-label="DATUM — kembali ke beranda"
                  className="inline-block rounded-sm transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--foreground)]/40"
                >
                  <DatumWordmark className="h-5 w-auto text-[var(--foreground)] sm:h-6" />
                </Link>
                {/* The name/role line wraps to two lines on phones and isn't
                    needed while working a board — show it from sm+ only. */}
                <div className="mt-1.5 hidden text-xs font-medium text-[var(--text-secondary)] sm:block">
                  {staff.full_name} · {staff.role}
                  {staff.cost_visible && " · cost-visible"}
                </div>
              </div>
              {canManageAccess(staff) && (
                <Link
                  href="/library/durations"
                  className="hidden text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--foreground)] sm:block"
                >
                  Analisa Durasi
                </Link>
              )}
              <Link
                href="/risiko"
                className="hidden text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--foreground)] sm:block"
              >
                Risiko
              </Link>
            </div>
            <div className="flex items-center gap-2">
              {canManageAccess(staff) && (
                <Link
                  href="/library/steps"
                  className="hidden rounded border border-[var(--border)] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)] sm:inline-flex"
                >
                  Pustaka Langkah
                </Link>
              )}
              <NotificationBadge />
              <LogoutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col overflow-y-auto px-2 py-2 sm:px-8 sm:py-8">{children}</main>
      </div>
    </Providers>
  );
}
