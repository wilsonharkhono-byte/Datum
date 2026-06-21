import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { SessionProvider, useSession } from "@/lib/session/session";
import { QueryProvider } from "@/lib/query/provider";

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

export default function RootLayout() {
  return (
    <SessionProvider>
      <Gate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </Gate>
    </SessionProvider>
  );
}
