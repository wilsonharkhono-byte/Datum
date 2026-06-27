const KEY = "datum_assistant_seed";

/** Stash a prompt for ChatDock to pick up after navigation. SSR/no-storage safe. */
export function setAssistantSeed(prompt: string): void {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.setItem(KEY, prompt); } catch { /* storage disabled — degrade to no seed */ }
}

/** Read and clear the seed (one-shot). Returns null if absent or storage unavailable. */
export function takeAssistantSeed(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const v = sessionStorage.getItem(KEY);
    if (v !== null) sessionStorage.removeItem(KEY);
    return v;
  } catch { return null; }
}
