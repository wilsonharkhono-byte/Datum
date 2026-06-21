import { FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getProjectsList, keys } from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/env";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";

export default function MatrixScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => getProjectsList(supabase, SUPABASE_URL),
  });

  if (isLoading) {
    return (
      <Screen className="gap-2 pt-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
      </Screen>
    );
  }
  if (isError) {
    return <Screen><ErrorState message={`Gagal memuat proyek: ${(error as Error).message}`} onRetry={refetch} /></Screen>;
  }
  if (!data || data.length === 0) {
    return <Screen><OfflineBanner /><EmptyState message="Belum ada proyek yang ditugaskan." /></Screen>;
  }
  return (
    <Screen className="pt-3">
      <OfflineBanner />
      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Card className="mb-2" onPress={() => router.push(`/(tabs)/(matrix)/project/${item.project_code}` as any)}>
            <Text variant="label">{item.project_code}</Text>
            <Text>{item.project_name}</Text>
            {item.development_name ? <Text variant="muted">{item.development_name}</Text> : null}
          </Card>
        )}
      />
    </Screen>
  );
}
