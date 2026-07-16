// apps/mobile/lib/share/prefs.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLastShareTarget, setLastShareTarget } from "./prefs";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest"),
);

describe("share prefs", () => {
  beforeEach(() => AsyncStorage.clear());

  it("returns null when nothing stored", async () => {
    expect(await getLastShareTarget()).toBeNull();
  });

  it("round-trips a target", async () => {
    const t = { projectId: "p1", projectCode: "PAKUWON", topicId: "t1" };
    await setLastShareTarget(t);
    expect(await getLastShareTarget()).toEqual(t);
  });

  it("returns null on corrupt JSON", async () => {
    await AsyncStorage.setItem("share.lastTarget", "{not json");
    expect(await getLastShareTarget()).toBeNull();
  });

  it("returns null on wrong shape", async () => {
    await AsyncStorage.setItem("share.lastTarget", JSON.stringify({ projectId: 1 }));
    expect(await getLastShareTarget()).toBeNull();
  });
});
