// apps/mobile/lib/share/prefs.ts
/**
 * prefs.ts — last-used share target (project + topic), Trello-style default
 * for the share-sheet "Add to card" screen. Best-effort: storage errors and
 * corrupt values degrade to null, never throw.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "share.lastTarget";

export type LastShareTarget = {
  projectId: string;
  projectCode: string;
  topicId: string;
};

export async function getLastShareTarget(): Promise<LastShareTarget | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastShareTarget> | null;
    if (
      p &&
      typeof p.projectId === "string" &&
      typeof p.projectCode === "string" &&
      typeof p.topicId === "string"
    ) {
      return { projectId: p.projectId, projectCode: p.projectCode, topicId: p.topicId };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setLastShareTarget(t: LastShareTarget): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // best-effort
  }
}
