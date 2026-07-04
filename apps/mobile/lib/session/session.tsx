import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  const staffRef = useRef<CurrentStaff | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function resolve() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { staffRef.current = null; setStaff(null); setStatus("unauthenticated"); return; }
    let current: CurrentStaff | null;
    try {
      current = await getCurrentStaff(supabase);
    } catch (e) {
      // Transient staff-read failure (site connectivity) — do NOT sign out.
      // Keep whatever state we had; retry shortly if we never resolved staff.
      console.warn("[session] staff lookup failed, retrying:", (e as Error).message);
      if (!staffRef.current && retryTimer.current === null) {
        retryTimer.current = setTimeout(() => { retryTimer.current = null; void resolve(); }, 8000);
      }
      return;
    }
    if (!current) {
      // Confirmed orphan auth user (no staff row): never show a half-broken shell.
      await supabase.auth.signOut();
      staffRef.current = null; setStaff(null); setStatus("unauthenticated"); return;
    }
    staffRef.current = current;
    setStaff(current); setStatus("authenticated");
    // Fire-and-forget: register push token after auth is confirmed.
    // Any failure is swallowed inside registerForPushNotificationsAsync.
    registerForPushNotificationsAsync().catch(() => {});
  }

  useEffect(() => {
    resolve();
    const { data: sub } = supabase.auth.onAuthStateChange(() => resolve());
    return () => {
      sub.subscription.unsubscribe();
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    };
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
