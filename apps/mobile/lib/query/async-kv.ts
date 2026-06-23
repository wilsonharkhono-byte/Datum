import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AsyncKV } from "@datum/core";

export const asyncStorageKV: AsyncKV = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

/** Wipe the whole cache store on logout so a shared device leaks nothing. */
export function clearAsyncCache(): Promise<void> {
  return AsyncStorage.clear();
}
