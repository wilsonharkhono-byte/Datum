/**
 * Tests for useSignedAttachmentUrl.
 *
 * The hook resolves a schemeless card-attachments storage_path into a signed
 * https URL via core signAttachment, keyed/cached by storage path so expo-image's
 * uri cache isn't defeated on every render.
 *
 * Mocks: @/lib/supabase/client (stub) + @datum/core signAttachment.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const mockSignAttachment = jest.fn();
jest.mock("@datum/core", () => ({
  signAttachment: (...a: unknown[]) => mockSignAttachment(...a),
}));

import { useSignedAttachmentUrl } from "./useSignedAttachmentUrl";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useSignedAttachmentUrl", () => {
  beforeEach(() => jest.clearAllMocks());

  it("resolves a signed URL for a storage path", async () => {
    mockSignAttachment.mockResolvedValue({ ok: true, url: "https://signed.example/abc" });

    const { result } = renderHook(
      () => useSignedAttachmentUrl("proj/card/ev/uuid-foto.jpg"),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.url).toBe("https://signed.example/abc"));
    expect(result.current.isError).toBe(false);
    expect(mockSignAttachment).toHaveBeenCalledWith(
      expect.anything(),
      "proj/card/ev/uuid-foto.jpg",
    );
  });

  it("surfaces isError when signing fails", async () => {
    mockSignAttachment.mockResolvedValue({ ok: false, error: "Gagal membuat URL" });

    const { result } = renderHook(
      () => useSignedAttachmentUrl("proj/card/ev/uuid-foto.jpg"),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.url).toBeNull();
  });

  it("does not sign when storagePath is null (disabled)", async () => {
    const { result } = renderHook(() => useSignedAttachmentUrl(null), {
      wrapper: wrapper(),
    });

    expect(result.current.url).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockSignAttachment).not.toHaveBeenCalled();
  });
});
