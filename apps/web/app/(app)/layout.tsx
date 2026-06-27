import type { ReactNode } from "react";
import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/get-current-user";
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
      <div className="flex h-screen flex-col overflow-hidden bg-[#D2D0C4] text-[#141210]">
        <header className="shrink-0 border-b border-[#B5AFA8] bg-[#FDFAF6]">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-2 sm:px-8 sm:py-4">
            <div className="flex items-center gap-4">
              <div>
                <Link
                  href="/"
                  aria-label="DATUM — kembali ke beranda"
                  className="-m-1 inline-block rounded-sm p-1 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/40"
                >
                  {/* pointer-events-none so the whole link box is clickable —
                      an inline SVG only registers clicks on its painted glyphs,
                      leaving the gaps around the letters dead. */}
                  <DatumWordmark className="pointer-events-none h-5 w-auto text-[#141210] sm:h-6" />
                </Link>
                {/* The name/role line wraps to two lines on phones and isn't
                    needed while working a board — show it from sm+ only. */}
                <div className="mt-1.5 hidden text-xs font-medium text-[#524E49] sm:block">
                  {staff.full_name} · {staff.role}
                  {staff.cost_visible && " · cost-visible"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
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
