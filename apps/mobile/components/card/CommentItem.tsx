/**
 * CommentItem — renders a single card_comment row.
 * Read-only for this slice; write actions come in the next task.
 */

import { View } from "react-native";
import type { CardComment } from "@datum/db";
import { Text } from "@/components/ui/Text";

export function CommentItem({ comment }: { comment: CardComment }) {
  const dateStr = new Date(comment.created_at).toLocaleString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <View className="mb-2 rounded border border-border/40 bg-surface p-3">
      <View className="mb-1 flex-row items-center justify-between gap-2">
        {/* Staff name not embedded in CardComment; show staff_id truncated as fallback */}
        <Text className="text-[12px] font-semibold text-text-sec">
          {`Staff ${comment.created_by_staff_id?.slice(0, 6) ?? "?"}`}
        </Text>
        <Text className="text-[11px] text-text-muted">{dateStr}</Text>
      </View>
      <Text className="text-[14px] text-text leading-snug">{comment.body}</Text>
    </View>
  );
}
