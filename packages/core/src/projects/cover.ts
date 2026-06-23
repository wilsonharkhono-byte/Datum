/** Build the public Supabase Storage URL for a project cover. The storage base
    URL is injected (web: NEXT_PUBLIC_SUPABASE_URL, mobile: EXPO_PUBLIC_SUPABASE_URL)
    so this stays free of framework-specific env access. */
export function coverImageUrl(path: string | null | undefined, baseUrl: string): string | null {
  if (!path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/storage/v1/object/public/project-covers/${encoded}`;
}
