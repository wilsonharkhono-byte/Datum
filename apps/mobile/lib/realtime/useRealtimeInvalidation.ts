import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { subscribeToProjectChanges, subscribeToOwnNotifications } from "@datum/core";

/** Invalidate a project's board queries on realtime changes. */
export function useProjectRealtime(projectId: string | undefined, code: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    return subscribeToProjectChanges(supabase, projectId, () => {
      if (code) qc.invalidateQueries({ queryKey: ["board", code] });
    });
  }, [projectId, code, qc]);
}

/** Invalidate the notifications queries on realtime deltas. */
export function useNotificationsRealtime(staffId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!staffId) return;
    return subscribeToOwnNotifications(supabase, staffId, () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [staffId, qc]);
}
