import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { getDurationLearning } from "@/lib/learning/queries";
import { DurationLearningView } from "@/components/learning/DurationLearningView";

export default async function DurationLearningPage() {
  const caller = await getCurrentStaff();
  if (!caller || !canManageAccess(caller)) redirect("/");

  const supabase = await createSupabaseServerClient();
  const groups = await getDurationLearning(supabase);

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">Pengaturan firma</p>
        <h1 className="text-2xl font-semibold text-[#141210]">Analisa Durasi</h1>
      </header>
      <div className="mb-4 rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs text-[var(--sand-dark)]">
        Durasi aktual dihitung dari langkah yang sudah selesai (kalender hari, start → selesai). Menerapkan saran
        hanya memengaruhi seeding ruangan BARU; checklist yang sudah ada tidak berubah.
      </div>
      <DurationLearningView groups={groups} />
    </div>
  );
}
