/**
 * push.test.ts — registerForPushNotificationsAsync unit tests
 *
 * Mocking strategy:
 *   - expo-device: mock isDevice + deviceName
 *   - expo-notifications: mock getPermissionsAsync, requestPermissionsAsync, getExpoPushTokenAsync
 *   - expo-constants: mock Constants.easConfig / expoConfig
 *   - @datum/core: mock upsertPushToken
 *   - @/lib/supabase/client: stub (not called directly)
 *   - react-native: mock Platform.OS
 *
 * Covers:
 *   1. Not a device → returns null, upsert NOT called
 *   2. Permissions denied → returns null, upsert NOT called
 *   3. No EAS projectId → returns null, upsert NOT called
 *   4. Happy path → upsert called with token + platform, returns token
 */

// ─── Mock: expo-device ───────────────────────────────────────────────────────

const mockIsDevice = { value: true };
const mockDeviceName = { value: "iPhone 15 Pro" as string | null };

jest.mock("expo-device", () => ({
  get isDevice() { return mockIsDevice.value; },
  get deviceName() { return mockDeviceName.value; },
}));

// ─── Mock: expo-notifications ────────────────────────────────────────────────

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetExpoPushToken = jest.fn();

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushToken(...args),
}));

// ─── Mock: expo-constants ────────────────────────────────────────────────────

const mockProjectId = { value: "test-project-id" as string | undefined };

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get easConfig() {
      return mockProjectId.value ? { projectId: mockProjectId.value } : undefined;
    },
    expoConfig: { extra: { eas: {} } },
  },
}));

// ─── Mock: @datum/core ───────────────────────────────────────────────────────

const mockUpsertPushToken = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    upsertPushToken: (...args: unknown[]) => mockUpsertPushToken(...args),
  };
});

// ─── Mock: @/lib/supabase/client ─────────────────────────────────────────────

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

// ─── Mock: react-native Platform ─────────────────────────────────────────────
// jest-expo sets up the full RN environment — do NOT replace the entire module.
// We need Platform.OS to be ios/android for the upsert assertion; jest-expo
// defaults to "ios" in its test environment so no mock is needed here.

// ─── Tests ───────────────────────────────────────────────────────────────────

import { registerForPushNotificationsAsync } from "./push";

const EXPO_TOKEN = "ExponentPushToken[test-abc-123]";

function setupHappyPath() {
  mockIsDevice.value = true;
  mockDeviceName.value = "iPhone 15 Pro";
  mockProjectId.value = "test-project-id";
  mockGetPermissions.mockResolvedValue({ status: "granted" });
  mockGetExpoPushToken.mockResolvedValue({ type: "expo", data: EXPO_TOKEN });
  mockUpsertPushToken.mockResolvedValue({ ok: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupHappyPath();
});

describe("registerForPushNotificationsAsync — not a device", () => {
  it("returns null without calling upsert", async () => {
    mockIsDevice.value = false;
    const result = await registerForPushNotificationsAsync();
    expect(result).toBeNull();
    expect(mockUpsertPushToken).not.toHaveBeenCalled();
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });
});

describe("registerForPushNotificationsAsync — permissions denied", () => {
  it("returns null when already denied (no prompt)", async () => {
    mockGetPermissions.mockResolvedValue({ status: "denied" });
    mockRequestPermissions.mockResolvedValue({ status: "denied" });
    const result = await registerForPushNotificationsAsync();
    expect(result).toBeNull();
    expect(mockUpsertPushToken).not.toHaveBeenCalled();
  });

  it("returns null when user dismisses permission request", async () => {
    mockGetPermissions.mockResolvedValue({ status: "undetermined" });
    mockRequestPermissions.mockResolvedValue({ status: "denied" });
    const result = await registerForPushNotificationsAsync();
    expect(result).toBeNull();
    expect(mockUpsertPushToken).not.toHaveBeenCalled();
  });
});

describe("registerForPushNotificationsAsync — no EAS projectId", () => {
  it("returns null without calling upsert", async () => {
    mockProjectId.value = undefined;
    const result = await registerForPushNotificationsAsync();
    expect(result).toBeNull();
    expect(mockUpsertPushToken).not.toHaveBeenCalled();
    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
  });
});

describe("registerForPushNotificationsAsync — happy path", () => {
  it("calls upsert with the token and platform, returns the token string", async () => {
    const result = await registerForPushNotificationsAsync();
    expect(result).toBe(EXPO_TOKEN);
    expect(mockGetExpoPushToken).toHaveBeenCalledWith({ projectId: "test-project-id" });
    expect(mockUpsertPushToken).toHaveBeenCalledWith(
      {}, // stubbed supabase
      {
        token: EXPO_TOKEN,
        platform: "ios",
        deviceName: "iPhone 15 Pro",
      },
    );
  });

  it("still returns token even if upsert returns ok:false (DB error)", async () => {
    mockUpsertPushToken.mockResolvedValue({ ok: false, error: "RLS violation" });
    const result = await registerForPushNotificationsAsync();
    // Token obtained before upsert, so still returned
    expect(result).toBe(EXPO_TOKEN);
  });

  it("returns null if getExpoPushTokenAsync throws (network error)", async () => {
    mockGetExpoPushToken.mockRejectedValue(new Error("network error"));
    const result = await registerForPushNotificationsAsync();
    expect(result).toBeNull();
    expect(mockUpsertPushToken).not.toHaveBeenCalled();
  });

  it("passes undefined deviceName when Device.deviceName is null", async () => {
    mockDeviceName.value = null;
    const result = await registerForPushNotificationsAsync();
    expect(result).toBe(EXPO_TOKEN);
    expect(mockUpsertPushToken).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ deviceName: undefined }),
    );
  });
});
