"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeToAreaGateChanges } from "@/lib/gates/realtime";
import { subscribeToProjectChanges } from "@/lib/cards/realtime";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";

/** Client island for server-rendered gate views (schedule, rooms): re-renders
    the page via router.refresh() when area/gate data changes elsewhere, and
    shows a stale notice while a realtime channel is down. Renders nothing
    when healthy. Change events are already debounced 250ms in @datum/core.

    `projectEvents` additionally watches the cards channel (card_events etc.) —
    the schedule page's signal panel and stale-cell banner derive from
    card_events, so gate-table changes alone left them one navigation behind. */
export function AreaGatesRefresher({
  projectId,
  projectEvents = false,
}: {
  projectId: string;
  projectEvents?: boolean;
}) {
  const router = useRouter();
  const [gatesDown, setGatesDown] = useState(false);
  const [cardsDown, setCardsDown] = useState(false);

  useEffect(() => {
    const refresh = () => router.refresh();
    const unsubGates = subscribeToAreaGateChanges(projectId, refresh, (h) => {
      setGatesDown(h === "down");
      // Changes during the outage were missed — refresh to catch up.
      if (h === "recovered") refresh();
    });
    const unsubCards = projectEvents
      ? subscribeToProjectChanges(projectId, refresh, (h) => {
          setCardsDown(h === "down");
          if (h === "recovered") refresh();
        })
      : null;
    return () => {
      unsubGates();
      unsubCards?.();
    };
  }, [projectId, projectEvents, router]);

  return <StaleDataNotice realtimeDown={gatesDown || cardsDown} />;
}
