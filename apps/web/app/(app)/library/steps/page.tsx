import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { getStandardLibrary } from "@/lib/library/queries";
import { StepLibraryView } from "@/components/library/StepLibraryView";

export default async function StepLibraryPage() {
  const caller = await getCurrentStaff();
  if (!caller || !canManageAccess(caller)) redirect("/");

  const supabase = await createSupabaseServerClient();
  const library = await getStandardLibrary(supabase);

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">Pengaturan firma</p>
        <h1 className="text-2xl font-semibold text-[#141210]">Pustaka Langkah</h1>
      </header>
      <div className="mb-4 rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs text-[var(--sand-dark)]">
        Perubahan di sini hanya memengaruhi seeding ruangan BARU dan langkah yang ditambahkan lewat
        &quot;Dari rekomendasi&quot;. Checklist ruangan yang sudah ada tidak berubah.
      </div>
      <StepLibraryView library={library} />
    </div>
  );
}
