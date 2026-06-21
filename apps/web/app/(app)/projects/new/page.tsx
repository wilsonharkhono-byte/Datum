import Link from "next/link";
import { ProjectCreateForm } from "@/components/projects/ProjectCreateForm";

export default function NewProjectPage() {
  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <Link href="/" className="text-xs text-[var(--text-secondary)] hover:underline">← Beranda</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">Proyek baru</p>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Buat proyek</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Kode proyek jadi URL-friendly slug. Topik standar akan otomatis di-seed setelah proyek dibuat.
        </p>
      </header>
      <ProjectCreateForm />
    </div>
  );
}
