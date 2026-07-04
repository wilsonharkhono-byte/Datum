"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeToAreaGateChanges } from "@/lib/gates/realtime";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";

/** Client island for server-rendered gate views (schedule, rooms): re-renders
    the page via router.refresh() when area/gate data changes elsewhere, and
    shows a stale notice while the realtime channel is down. Renders nothing
    when healthy. Change events are already debounced 250ms in @datum/core. */
export function AreaGatesRefresher({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [down, setDown] = useState(false);
  useEffect(() => {
    return subscribeToAreaGateChanges(
      projectId,
      () => router.refresh(),
      (h) => {
        setDown(h === "down");
        // Changes during the outage were missed — refresh to catch up.
        if (h === "recovered") router.refresh();
      },
    );
  }, [projectId, router]);
  return <StaleDataNotice realtimeDown={down} />;
}
