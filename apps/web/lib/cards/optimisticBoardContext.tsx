"use client";
import { createContext, useContext } from "react";

export type OptimisticBoardApi = {
  /** Paint a ghost card in `topicId` immediately. Must be called inside a
      transition (it is, from AddCardForm's startTransition). */
  addOptimisticCard: (topicId: string, title: string) => void;
};

const OptimisticBoardContext = createContext<OptimisticBoardApi | null>(null);

export const OptimisticBoardProvider = OptimisticBoardContext.Provider;

/** Access the board's optimistic API from any descendant of <Board>. */
export function useOptimisticBoard(): OptimisticBoardApi {
  const ctx = useContext(OptimisticBoardContext);
  if (!ctx) throw new Error("useOptimisticBoard must be used inside <Board>");
  return ctx;
}
