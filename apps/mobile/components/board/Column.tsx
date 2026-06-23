import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui/Text";
import { MiniCard } from "./MiniCard";
import { AddCardForm } from "./AddCardForm";
import type { BoardColumn } from "@datum/core";

type Props = {
  column: BoardColumn;
  projectId: string;
  projectCode: string;
  todayStr?: string; // injected for tests
};

export function Column({ column, projectId, projectCode, todayStr }: Props) {
  return (
    <View className="w-full rounded bg-surface-alt/50 p-2">
      {/* Column header */}
      <Text className="mb-2 px-1 text-[11px] font-bold uppercase tracking-widest text-text-sec">
        {column.topic.name}
      </Text>

      {/* Cards */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
        nestedScrollEnabled
      >
        {column.cards.length === 0 ? (
          <View className="rounded border border-dashed border-border p-6">
            <Text className="text-[11px] italic text-text-sec">
              Belum ada kartu di kolom ini
            </Text>
            <Text className="mt-1 text-[10px] text-text-muted">
              Ketuk &quot;+ tambah kartu&quot; di bawah untuk membuat.
            </Text>
          </View>
        ) : (
          <View className="gap-1.5">
            {column.cards.map((card) => (
              <MiniCard
                key={card.id}
                card={card}
                projectCode={projectCode}
                todayStr={todayStr}
              />
            ))}
          </View>
        )}

        <AddCardForm
          projectId={projectId}
          topicId={column.topic.id}
          projectCode={projectCode}
        />
      </ScrollView>
    </View>
  );
}
