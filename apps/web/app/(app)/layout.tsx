import type { ReactNode } from "react";
import { getCurrentStaff } from "@/lib/auth/get-current-user";
import { redirect } from "next/navigation";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-3">
        <div>
          <div className="text-lg font-semibold text-stone-900">DATUM</div>
          <div className="text-xs text-stone-500">
            {staff.full_name} · {staff.role}
            {staff.cost_visible && " · cost-visible"}
          </div>
        </div>
        <LogoutButton />
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
