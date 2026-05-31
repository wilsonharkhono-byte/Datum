"use client";

import { useTransition, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await supabase.auth.signOut();
          router.push("/login");
        })
      }
      className="h-10 rounded-[8px] border border-[#B5AFA8] px-4 text-sm font-semibold text-[#524E49] transition hover:bg-[#F2EFE9] disabled:opacity-50"
    >
      Keluar
    </button>
  );
}
