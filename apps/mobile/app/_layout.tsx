import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { SessionProvider, useSession } from "@/lib/session/session";
import { QueryProvider } from "@/lib/query/provider";
import { shouldRedirectToShare } from "@/lib/share/intent";

function Gate({ children }: { children: React.ReactNode }) {
  const { status, staff } = useSession();
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    if (status === "loading") return;
    const inAuth = segments[0] === "(auth)";
    if (status === "unauthenticated" && !inAuth) router.replace("/(auth)/login");
    if (status === "authenticated" && inAuth) router.replace("/(tabs)/(matrix)");
  }, [status, segments, router]);
  if (status === "authenticated" && staff) {
    return <QueryProvider userId={staff.id}>{children}</QueryProvider>;
  }
  return <>{children}</>;
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
