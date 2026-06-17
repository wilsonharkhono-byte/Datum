// Client-side cover-image downscale + re-encode. Keeps uploads under the
// project-covers bucket's 10 MB limit and makes the landing page light (covers
// render small). Pure browser APIs — no dependencies.

const COVER_MAX_DIM = 1600; // longest edge for a cover render
const COVER_QUALITY = 0.82;
const COVER_TYPE = "image/webp"; // bucket allows jpeg/png/webp

/** Pure: scale (w,h) down so the longest edge ≤ maxDim, preserving aspect. */
export function targetDimensions(w: number, h: number, maxDim: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxDim) return { w, h };
  const scale = maxDim / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * Downscale + re-encode an image File to WebP in the browser. Returns a new
 * File; rejects if the browser can't decode the input (e.g. HEIC), so callers
 * can fall back to the original and let Storage validate it.
 */
export async function compressCoverImage(file: File): Promise<File> {
  // `imageOrientation: "from-image"` bakes in EXIF rotation so portrait phone
  // photos don't come out sideways after the canvas re-encode.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { w, h } = targetDimensions(bitmap.width, bitmap.height, COVER_MAX_DIM);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file; // no 2d context → upload original
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, COVER_TYPE, COVER_QUALITY),
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "cover";
    return new File([blob], `${base}.webp`, { type: COVER_TYPE });
  } finally {
    bitmap.close?.();
  }
}
