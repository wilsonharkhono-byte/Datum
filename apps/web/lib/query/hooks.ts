"use client";
import { useQuery } from "@tanstack/react-query";
import { keys } from "./keys";
import type { Board } from "@/lib/cards/queries";
import type { ProjectListItem } from "@/lib/projects/queries";
import type { CardPayload } from "@/app/api/card/[code]/[slug]/route";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export function useBoard(code: string, initialData: Board) {
  return useQuery({
    queryKey: keys.board(code),
    queryFn: () => fetchJson<Board>(`/api/board/${code}`),
    initialData,
  });
}

export function useProjects(initialData: ProjectListItem[]) {
  return useQuery({
    queryKey: keys.projects(),
    queryFn: () => fetchJson<ProjectListItem[]>(`/api/projects`),
    initialData,
  });
}

export function useCard(code: string, slug: string, initialData: CardPayload) {
  return useQuery({
    queryKey: keys.card(code, slug),
    queryFn: () => fetchJson<CardPayload>(`/api/card/${code}/${slug}`),
    initialData,
  });
}
