"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  markNotificationRead as coreMarkRead,
  markAllNotificationsRead as coreMarkAllRead,
  type NotificationResult,
} from "@datum/core";

const MarkReadFormInput = z.object({
  notificationId: z.string().uuid(),
});

export async function markNotificationRead(formData: FormData): Promise<NotificationResult> {
  let input;
  try {
    input = MarkReadFormInput.parse({ notificationId: formData.get("notificationId") });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const result = await coreMarkRead(supabase, input.notificationId);
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<NotificationResult> {
  const supabase = await createSupabaseServerClient();
  const result = await coreMarkAllRead(supabase);
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return { ok: true };
}
