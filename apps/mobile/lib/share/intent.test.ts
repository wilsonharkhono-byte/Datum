import { shouldRedirectToShare, sharedFilesToAssets } from "./intent";

describe("shouldRedirectToShare", () => {
  const base = { hasShareIntent: true, status: "authenticated" as const, firstSegment: "(tabs)" as string | undefined };
  it("redirects an authenticated user with a pending intent", () => {
    expect(shouldRedirectToShare(base)).toBe(true);
  });
  it("holds while session is loading (intent survives; resume-after-login)", () => {
    expect(shouldRedirectToShare({ ...base, status: "loading" })).toBe(false);
    expect(shouldRedirectToShare({ ...base, status: "unauthenticated" })).toBe(false);
  });
  it("does not loop when already on /share", () => {
    expect(shouldRedirectToShare({ ...base, firstSegment: "share" })).toBe(false);
  });
  it("does nothing without an intent", () => {
    expect(shouldRedirectToShare({ ...base, hasShareIntent: false })).toBe(false);
  });
});

describe("sharedFilesToAssets", () => {
  it("maps intent files to PickedAsset with fallbacks", () => {
    const out = sharedFilesToAssets([
      { path: "file:///a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 123 },
      { path: "file:///b", fileName: null, mimeType: "image/png", size: null },
    ] as never);
    expect(out).toEqual([
      { uri: "file:///a.jpg", name: "a.jpg", mimeType: "image/jpeg", size: 123 },
      { uri: "file:///b", name: expect.stringMatching(/^foto-/), mimeType: "image/png", size: 0 },
    ]);
  });
  it("filters non-images and handles null", () => {
    expect(sharedFilesToAssets(null)).toEqual([]);
    expect(
      sharedFilesToAssets([{ path: "file:///x.pdf", fileName: "x.pdf", mimeType: "application/pdf", size: 5 }] as never),
    ).toEqual([]);
  });
});
