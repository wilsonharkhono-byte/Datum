"use client";

import { useTransition, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearIdbCache } from "@/lib/query/idb-kv";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const qc = useQueryClient();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await supabase.auth.signOut();
          qc.clear();
          await clearIdbCache();
          router.push("/login");
        })
      }
      className="h-8 rounded-[8px] border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50 sm:h-10 sm:px-4 sm:text-sm"
    >
      Keluar
    </button>
  );
}
