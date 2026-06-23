import { asyncStorageKV, clearAsyncCache } from "../../lib/query/async-kv";

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
      clear: jest.fn(async () => void store.clear()),
    },
  };
});

describe("asyncStorageKV", () => {
  it("round-trips and removes a value through AsyncStorage", async () => {
    await asyncStorageKV.setItem("k", "v");
    expect(await asyncStorageKV.getItem("k")).toBe("v");
    await asyncStorageKV.removeItem("k");
    expect(await asyncStorageKV.getItem("k")).toBeNull();
  });
  it("clearAsyncCache wipes everything", async () => {
    await asyncStorageKV.setItem("a", "1");
    await clearAsyncCache();
    expect(await asyncStorageKV.getItem("a")).toBeNull();
  });
});
