import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { SessionProvider, useSession } from "@/lib/session/session";
import { QueryProvider } from "@/lib/query/provider";
import { shouldRedirectToShare } from "@/lib/share/intent";

export function Gate({ children }: { children: React.ReactNode }) {
  const { status, staff } = useSession();
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    if (status === "loading") return;
    const inAuth = segments[0] === "(auth)";
    if (status === "unauthenticated" && !inAuth) router.replace("/(auth)/login");
    if (status === "authenticated" && inAuth) router.replace("/(tabs)/(matrix)");
  }, [status, segments, router]);
  // Hold the tree until the session state is known — prevents the initial
  // route from mounting (and firing queries) before the login redirect runs.
  if (status === "loading") return null;
  // ALWAYS provide a QueryClient: expo-router mounts the initial (tabs) route
  // for a frame before the redirect effect runs, and TabsLayout calls useQuery
  // (inbox badge) — without a client that frame hard-crashes release builds.
  // Keyed per identity so each login gets a fresh client (no cache bleed).
  const staffId = status === "authenticated" && staff ? staff.id : null;
  return (
    <QueryProvider key={staffId ?? "anon"} userId={staffId}>
      {children}
    </QueryProvider>
  );
}

/**
 * Redirects to /share once an authenticated user has a pending share intent.
 * The provider keeps hasShareIntent true across the login flow, so a share that
 * arrives while logged out resumes here after Gate lands the user in the tabs.
 */
function ShareIntentRedirect() {
  const { hasShareIntent } = useShareIntentContext();
  const { status } = useSession();
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    if (shouldRedirectToShare({ hasShareIntent, status, firstSegment: segments[0] })) {
      router.replace("/share");
    }
  }, [hasShareIntent, status, segments, router]);
  return null;
}

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <SessionProvider>
        <ShareIntentRedirect />
        <Gate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="share" options={{ presentation: "modal" }} />
          </Stack>
        </Gate>
      </SessionProvider>
    </ShareIntentProvider>
  );
}
