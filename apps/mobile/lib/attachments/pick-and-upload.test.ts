/**
 * Tests for pick-and-upload.ts
 *
 * All external deps are mocked:
 *   - expo-image-picker  (permission states + picker results)
 *   - expo-crypto        (fixed UUID)
 *   - @datum/core        (attachmentStoragePath, attachToEvent, attachmentSkipReason)
 *   - globalThis.fetch   (uri → blob)
 *   - supabase client    (.storage.from().upload)
 */

import { pickImageAsset, uploadCardAttachment } from "./pick-and-upload";
import type { PickAndUploadResult } from "./pick-and-upload";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const FIXED_UUID = "test-uuid-1234";
const FIXED_PATH = "proj-id/card-id/event-id/test-uuid-1234-foto.jpg";

// expo-image-picker
const mockRequestPermissions = jest.fn();
const mockLaunchImageLibrary = jest.fn();
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestPermissions(...args),
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibrary(...args),
}));

// expo-crypto
jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => FIXED_UUID),
}));

// @datum/core — wrap each in (...args: unknown[]) per project convention
const mockAttachmentStoragePath = jest.fn();
const mockAttachToEvent = jest.fn();
const mockAttachmentSkipReason = jest.fn();
jest.mock("@datum/core", () => ({
  attachmentStoragePath: (...args: unknown[]) =>
    mockAttachmentStoragePath(...args),
  attachToEvent: (...args: unknown[]) => mockAttachToEvent(...args),
  attachmentSkipReason: (...args: unknown[]) =>
    mockAttachmentSkipReason(...args),
}));

// globalThis.fetch → blob (matches members.test.tsx pattern)
const FAKE_BLOB = new Blob(["fake"]);
const mockFetch = jest.fn();
(globalThis as { fetch: unknown }).fetch = mockFetch;

// Supabase storage mock
const mockUpload = jest.fn();
const mockFrom = jest.fn(() => ({ upload: mockUpload }));
const mockSupabase = {
  storage: { from: mockFrom },
} as unknown as Parameters<typeof uploadCardAttachment>[0];

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ASSET_JPEG = {
  uri: "file:///var/mobile/foto.jpg",
  name: "foto.jpg",
  mimeType: "image/jpeg",
  size: 500_000,
};

const UPLOAD_ARGS = {
  projectId: "proj-id",
  cardId: "card-id",
  cardEventId: "event-id",
  asset: ASSET_JPEG,
};

// ─── pickImageAsset ───────────────────────────────────────────────────────────

describe("pickImageAsset", () => {
  beforeEach(() => {
    mockRequestPermissions.mockReset();
    mockLaunchImageLibrary.mockReset();
  });

  it("returns null when permission is denied", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "denied" });
    const result = await pickImageAsset();
    expect(result).toBeNull();
    expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
  });

  it("returns null when user cancels the picker", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "granted" });
    mockLaunchImageLibrary.mockResolvedValueOnce({ canceled: true, assets: [] });
    const result = await pickImageAsset();
    expect(result).toBeNull();
  });

  it("returns null when assets array is empty", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "granted" });
    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [],
    });
    const result = await pickImageAsset();
    expect(result).toBeNull();
  });

  it("returns asset on success with all fields", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "granted" });
    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///img.png",
          fileName: "img.png",
          mimeType: "image/png",
          fileSize: 200_000,
        },
      ],
    });
    const result = await pickImageAsset();
    expect(result).toEqual({
      uri: "file:///img.png",
      name: "img.png",
      mimeType: "image/png",
      size: 200_000,
    });
  });

  it("falls back to generated name when fileName is null", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "granted" });
    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///img.jpg",
          fileName: null,
          mimeType: "image/jpeg",
          fileSize: 100_000,
        },
      ],
    });
    const result = await pickImageAsset();
    expect(result).not.toBeNull();
    expect(result!.name).toMatch(/^foto-\d+\.jpg$/);
  });

  it("defaults mimeType to image/jpeg when null", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ status: "granted" });
    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///img.jpg",
          fileName: "img.jpg",
          mimeType: null,
          fileSize: 100_000,
        },
      ],
    });
    const result = await pickImageAsset();
    expect(result!.mimeType).toBe("image/jpeg");
  });
});

// ─── uploadCardAttachment ─────────────────────────────────────────────────────

describe("uploadCardAttachment", () => {
  beforeEach(() => {
    mockAttachmentSkipReason.mockReset();
    mockAttachmentStoragePath.mockReset();
    mockUpload.mockReset();
    mockAttachToEvent.mockReset();
    mockFetch.mockReset();
    mockFrom.mockReset();
    mockFrom.mockReturnValue({ upload: mockUpload });

    // Default: all ok
    mockAttachmentSkipReason.mockReturnValue(null);
    mockAttachmentStoragePath.mockReturnValue(FIXED_PATH);
    mockUpload.mockResolvedValue({ error: null });
    mockAttachToEvent.mockResolvedValue({ ok: true });
    mockFetch.mockResolvedValue({
      blob: () => Promise.resolve(FAKE_BLOB),
    });
  });

  it("happy path: uploads to card-attachments and calls attachToEvent with the right path", async () => {
    const result = await uploadCardAttachment(mockSupabase, UPLOAD_ARGS);

    expect(result).toEqual({ ok: true });

    // Storage bucket is always "card-attachments"
    expect(mockFrom).toHaveBeenCalledWith("card-attachments");

    // Upload is called with the path returned by attachmentStoragePath
    expect(mockUpload).toHaveBeenCalledWith(
      FIXED_PATH,
      FAKE_BLOB,
      expect.objectContaining({ contentType: "image/jpeg" }),
    );

    // attachToEvent receives the same path
    expect(mockAttachToEvent).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        cardEventId: "event-id",
        storagePath: FIXED_PATH,
        mimeType: "image/jpeg",
      }),
    );

    // attachmentStoragePath is called with the right args including a uuid
    expect(mockAttachmentStoragePath).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-id",
        cardId: "card-id",
        cardEventId: "event-id",
        fileName: "foto.jpg",
        uuid: FIXED_UUID,
      }),
    );
  });

  it("returns skipped result with friendly message for oversize files", async () => {
    mockAttachmentSkipReason.mockReturnValue("oversize");
    const result: PickAndUploadResult = await uploadCardAttachment(
      mockSupabase,
      UPLOAD_ARGS,
    );

    expect(result.ok).toBe(false);
    expect("skipped" in result && result.skipped).toBe(true);
    if (!result.ok && "skipped" in result && result.skipped) {
      expect(result.reason).toMatch(/20 MB/);
    }

    // Should NOT have touched storage or DB
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockAttachToEvent).not.toHaveBeenCalled();
  });

  it("returns skipped result with friendly message for unsupported MIME", async () => {
    mockAttachmentSkipReason.mockReturnValue("unsupported");
    const heicAsset = { ...ASSET_JPEG, mimeType: "image/heic" };
    const result: PickAndUploadResult = await uploadCardAttachment(mockSupabase, {
      ...UPLOAD_ARGS,
      asset: heicAsset,
    });

    expect(result.ok).toBe(false);
    expect("skipped" in result && result.skipped).toBe(true);
    if (!result.ok && "skipped" in result && result.skipped) {
      expect(result.reason).toMatch(/tidak didukung/);
    }

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockAttachToEvent).not.toHaveBeenCalled();
  });

  it("returns readable error when upload fails", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Bucket not found" } });
    const result: PickAndUploadResult = await uploadCardAttachment(
      mockSupabase,
      UPLOAD_ARGS,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !("skipped" in result && result.skipped)) {
      expect((result as { ok: false; error: string }).error).toMatch(/Upload gagal/);
      expect((result as { ok: false; error: string }).error).toContain("Bucket not found");
    }

    // DB row must not be inserted when upload fails
    expect(mockAttachToEvent).not.toHaveBeenCalled();
  });

  it("returns readable error when attachToEvent fails", async () => {
    mockAttachToEvent.mockResolvedValue({ ok: false, error: "RLS policy violation" });
    const result: PickAndUploadResult = await uploadCardAttachment(
      mockSupabase,
      UPLOAD_ARGS,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !("skipped" in result && result.skipped)) {
      expect((result as { ok: false; error: string }).error).toMatch(/Simpan lampiran gagal/);
      expect((result as { ok: false; error: string }).error).toContain("RLS policy violation");
    }
  });

  it("returns readable error when fetch fails to read the file URI", async () => {
    mockFetch.mockRejectedValue(new Error("ENOENT: file not found"));
    const result: PickAndUploadResult = await uploadCardAttachment(
      mockSupabase,
      UPLOAD_ARGS,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !("skipped" in result && result.skipped)) {
      expect((result as { ok: false; error: string }).error).toMatch(/Gagal membaca file/);
    }

    // Should NOT have touched storage when blob read fails
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
