import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCurrentStaff, type CurrentStaff } from "@datum/core";
import { clearAsyncCache } from "@/lib/query/async-kv";
import { registerForPushNotificationsAsync } from "@/lib/notifications/push";

type Status = "loading" | "authenticated" | "unauthenticated";
type SessionValue = { status: Status; staff: CurrentStaff | null; signOut: () => Promise<void> };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [staff, setStaff] = useState<CurrentStaff | null>(null);

  async function resolve() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStaff(null); setStatus("unauthenticated"); return; }
    const current = await getCurrentStaff(supabase);
    if (!current) {
      // Orphan auth user (no staff row): never show a half-broken shell.
      await supabase.auth.signOut();
      setStaff(null); setStatus("unauthenticated"); return;
    }
    setStaff(current); setStatus("authenticated");
    // Fire-and-forget: register push token after auth is confirmed.
    // Any failure is swallowed inside registerForPushNotificationsAsync.
    registerForPushNotificationsAsync().catch(() => {});
  }

  useEffect(() => {
    resolve();
    const { data: sub } = supabase.auth.onAuthStateChange(() => resolve());
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await clearAsyncCache();
    await supabase.auth.signOut();
  }

  return <SessionContext.Provider value={{ status, staff, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
