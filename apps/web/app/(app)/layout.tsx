import type { ReactNode } from "react";
import { getCurrentStaff } from "@/lib/auth/get-current-user";
import { redirect } from "next/navigation";
import { LogoutButton } from "./logout-button";
import { NotificationBadge } from "@/components/notifications/NotificationBadge";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  return (
    <div className="min-h-screen bg-[#D2D0C4] text-[#141210]">
      <header className="border-b border-[#B5AFA8] bg-[#FDFAF6]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-[8px] bg-[#141210] text-sm font-bold text-[#FDFAF6]">
              D
            </div>
            <div>
              <div className="text-lg font-semibold leading-none text-[#141210]">DATUM</div>
              <div className="mt-1 text-xs font-medium text-[#524E49]">
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
      <main className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
