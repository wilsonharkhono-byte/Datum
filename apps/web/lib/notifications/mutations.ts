"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MarkReadInput = z.object({
  notificationId: z.string().uuid(),
});

export type NotificationResult = { ok: true } | { ok: false; error: string };

export async function markNotificationRead(formData: FormData): Promise<NotificationResult> {
  let input;
  try {
    input = MarkReadInput.parse({ notificationId: formData.get("notificationId") });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", input.notificationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<NotificationResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}
