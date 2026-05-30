import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Staff } from "@datum/db";

export async function getCurrentStaff(): Promise<Staff | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("staff").select("*").eq("id", user.id).single();
  return data ?? null;
}
