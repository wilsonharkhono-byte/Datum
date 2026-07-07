import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import {
  subscribeToProjectChanges,
  subscribeToOwnNotifications,
  subscribeToAreaGateChanges,
  keys,
} from "@datum/core";

/** Invalidate a project's board queries on realtime changes. */
export function useProjectRealtime(projectId: string | undefined, code: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    return subscribeToProjectChanges(supabase, projectId, () => {
      if (code) qc.invalidateQueries({ queryKey: keys.board(code) });
    });
  }, [projectId, code, qc]);
}

/**
 * Invalidate matrix/schedule/areaTargets (and rooms+areas if slug is provided)
 * when area_gate_status, areas, or card_areas change for a project.
 *
 * card_areas has no project_id column and is subscribed unfiltered; RLS on the
 * table still limits what Supabase sends to the authenticated client.
 */
export function useAreaGatesRealtime(projectId: string | undefined, slug?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    return subscribeToAreaGateChanges(supabase, projectId, () => {
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
      void qc.invalidateQueries({ queryKey: keys.schedule(projectId) });
      void qc.invalidateQueries({ queryKey: keys.areaTargets(projectId) });
      if (slug) {
        void qc.invalidateQueries({ queryKey: keys.rooms(slug) });
        void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
      }
    });
  }, [projectId, slug, qc]);
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
