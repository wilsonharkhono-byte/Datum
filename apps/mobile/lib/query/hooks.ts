import { useQuery } from "@tanstack/react-query";
import {
  getProjectsList,
  getDevelopments,
  getBoardForProject,
  getProjectTopics,
  keys,
} from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/env";

export function useProjects() {
  return useQuery({
    queryKey: keys.projects(),
    queryFn: () => getProjectsList(supabase, SUPABASE_URL),
  });
}

export function useDevelopments() {
  return useQuery({
    queryKey: ["developments"],
    queryFn: () => getDevelopments(supabase),
  });
}

export function useBoard(code: string) {
  return useQuery({
    queryKey: keys.board(code),
    queryFn: () => getBoardForProject(supabase, code),
  });
}

export function useProjectTopics(projectId: string | undefined) {
  return useQuery({
    queryKey: ["topics", projectId],
    enabled: !!projectId,
    queryFn: () => getProjectTopics(supabase, projectId!),
  });
}
