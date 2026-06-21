import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import type { ProjectListItem } from "@datum/core";
import { developmentTint } from "@datum/core";
import { Text } from "@/components/ui/Text";

const statusLabel: Record<string, string> = {
  design: "Desain",
  construction: "Konstruksi",
  finishing: "Finishing",
  handover: "Serah terima",
  closed: "Selesai",
};

/** Trailing unit token (e.g. "E7-20") for the fallback cover — mirrors web's unitCode. */
function unitCode(p: ProjectListItem): string {
  const tokens = p.project_name.trim().split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";
  return /[0-9/]/.test(last) ? last : p.project_code;
}

export function ProjectCard({ project }: { project: ProjectListItem }) {
  const router = useRouter();
  const tint = developmentTint(project.development_name ?? "");

  return (
    <Pressable
      testID={`project-card-${project.project_code}`}
      accessibilityRole="button"
      accessibilityLabel={`Proyek ${project.project_code}`}
      onPress={() => router.push(`/(tabs)/(matrix)/project/${project.project_code}` as any)}
      className="mb-3 overflow-hidden rounded border border-border/40 bg-surface active:opacity-80"
    >
      {/* Cover image or tinted fallback */}
      <View className="h-24 w-full" style={{ backgroundColor: tint.bg }}>
        {project.cover_url ? (
          <Image
            source={{ uri: project.cover_url }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            onError={() => {/* fallback stays visible via bg color */}}
          />
        ) : (
          <View className="flex-1 items-center justify-center px-2">
            <Text
              className="text-center text-[15px] font-bold uppercase tracking-wide"
              style={{ color: tint.fg }}
            >
              {unitCode(project)}
            </Text>
          </View>
        )}
      </View>

      {/* Card body */}
      <View className="p-3">
        <Text variant="label">{project.project_code}</Text>
        <Text className="mt-0.5 text-[14px] text-text">{project.project_name}</Text>
        <Text variant="muted" className="mt-1">
          Client: {project.client_name ?? "-"}
        </Text>
        {/* Status pill */}
        <View className="mt-2 self-start rounded-sm bg-border/20 px-2 py-1">
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-text-sec">
            {statusLabel[project.status] ?? project.status}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
