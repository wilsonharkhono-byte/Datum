"use client";
import { get, set, del, clear, createStore } from "idb-keyval";
import type { AsyncKV } from "./persister";

const store = createStore("datum-cache", "rq");

export const idbKV: AsyncKV = {
  getItem: (k) => get<string>(k, store).then((v) => v ?? null),
  setItem: (k, v) => set(k, v, store),
  removeItem: (k) => del(k, store),
};

/** Wipe the entire cache store — used on logout so a shared device leaks nothing. */
export function clearIdbCache(): Promise<void> {
  return clear(store);
}
