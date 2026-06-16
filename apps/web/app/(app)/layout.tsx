import type { ReactNode } from "react";
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
                <DatumWordmark className="h-5 w-auto text-[#141210] sm:h-6" />
                <div className="mt-0.5 text-[10px] font-medium text-[#524E49] sm:mt-1.5 sm:text-xs">
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
