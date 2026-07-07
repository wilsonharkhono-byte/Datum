"use client";

import { useTransition, useState } from "react";
import messages from "@/messages/id.json";
import { signIn } from "./actions";
import { DatumWordmark } from "@/components/DatumWordmark";

export default function LoginPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await signIn(formData);
      if (result && !result.ok) setError(messages.login.error);
    });
  }

  return (
    <div className="grid w-full max-w-5xl overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_50px_rgba(90,74,58,0.12)] lg:grid-cols-[1.05fr_0.95fr]">
      <section className="bg-[var(--foreground)] px-8 py-10 text-[var(--surface)] sm:px-10">
        <div className="mb-16 flex items-center gap-3">
          <span className="block h-2.5 w-2.5 rounded-full bg-[var(--sand)]" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sand)]">
            WHAstudio
          </span>
        </div>
        <div className="max-w-md">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sand)]">
            Sistem kontrol finishing
          </p>
          <DatumWordmark className="h-10 w-auto text-[var(--surface)] sm:h-12" />
          <span className="sr-only">DATUM</span>
          <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--surface)]/70">
            Dashboard internal untuk melihat proyek, area, dan kesiapan gate
            finishing dalam satu halaman kerja.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-3 gap-3 text-xs text-[var(--surface)]/72">
          <div className="rounded-[8px] border border-[var(--surface)]/15 p-3">
            <div className="font-semibold text-[var(--sand)]">A-H</div>
            <div className="mt-1">Gate</div>
          </div>
          <div className="rounded-[8px] border border-[var(--surface)]/15 p-3">
            <div className="font-semibold text-[var(--sand)]">Area</div>
            <div className="mt-1">Matrix</div>
          </div>
          <div className="rounded-[8px] border border-[var(--surface)]/15 p-3">
            <div className="font-semibold text-[var(--sand)]">RLS</div>
            <div className="mt-1">Aman</div>
          </div>
        </div>
      </section>

      <form action={handleSubmit} className="px-8 py-10 sm:px-10">
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
            Masuk dashboard
          </p>
          <h2 className="text-2xl font-semibold text-[var(--foreground)]">{messages.login.title}</h2>
        </div>

        <label className="mb-5 block">
          <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{messages.login.email}</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="h-11 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--foreground)] outline-none transition focus:border-[var(--sand-dark)] focus:ring-2 focus:ring-[var(--sand)]/30"
          />
        </label>
        <label className="mb-6 block">
          <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{messages.login.password}</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="h-11 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--foreground)] outline-none transition focus:border-[var(--sand-dark)] focus:ring-2 focus:ring-[var(--sand)]/30"
          />
        </label>
        {error && (
          <p className="mb-4 rounded-[8px] bg-[var(--flag-critical-bg)] px-3 py-2 text-sm font-medium text-[var(--flag-critical)]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="h-11 w-full rounded-[8px] bg-[var(--foreground)] px-4 text-sm font-semibold text-[var(--surface)] transition hover:bg-[var(--sand-darker)] disabled:opacity-50"
        >
          {isPending ? messages.login.loading : messages.login.submit}
        </button>
      </form>
    </div>
  );
}
