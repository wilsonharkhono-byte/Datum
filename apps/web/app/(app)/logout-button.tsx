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
      className="text-sm text-stone-600 underline disabled:opacity-50"
    >
      Logout
    </button>
  );
}
