"use client";

import { useTransition, useState } from "react";
import messages from "@/messages/id.json";
import { signIn } from "./actions";

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
    <div className="grid w-full max-w-5xl overflow-hidden rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] shadow-[0_18px_50px_rgba(90,74,58,0.12)] lg:grid-cols-[1.05fr_0.95fr]">
      <section className="bg-[#141210] px-8 py-10 text-[#FDFAF6] sm:px-10">
        <div className="mb-16 flex items-center gap-3">
          <span className="block h-2.5 w-2.5 rounded-full bg-[#B29F86]" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#B29F86]">
            WHAstudio
          </span>
        </div>
        <div className="max-w-md">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#B29F86]">
            Sistem kontrol finishing
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-[#FDFAF6] sm:text-5xl">
            DATUM
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-[#FDFAF6]/70">
            Dashboard internal untuk melihat proyek, area, dan kesiapan gate
            finishing dalam satu halaman kerja.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-3 gap-3 text-xs text-[#FDFAF6]/72">
          <div className="rounded-[8px] border border-[#FDFAF6]/15 p-3">
            <div className="font-semibold text-[#B29F86]">A-H</div>
            <div className="mt-1">Gate</div>
          </div>
          <div className="rounded-[8px] border border-[#FDFAF6]/15 p-3">
            <div className="font-semibold text-[#B29F86]">Area</div>
            <div className="mt-1">Matrix</div>
          </div>
          <div className="rounded-[8px] border border-[#FDFAF6]/15 p-3">
            <div className="font-semibold text-[#B29F86]">RLS</div>
            <div className="mt-1">Aman</div>
          </div>
        </div>
      </section>

      <form action={handleSubmit} className="px-8 py-10 sm:px-10">
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">
            Masuk dashboard
          </p>
          <h2 className="text-2xl font-semibold text-[#141210]">{messages.login.title}</h2>
        </div>

        <label className="mb-5 block">
          <span className="mb-2 block text-sm font-medium text-[#524E49]">{messages.login.email}</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="h-11 w-full rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] px-3 text-[#141210] outline-none transition focus:border-[#7A6B56] focus:ring-2 focus:ring-[#B29F86]/30"
          />
        </label>
        <label className="mb-6 block">
          <span className="mb-2 block text-sm font-medium text-[#524E49]">{messages.login.password}</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="h-11 w-full rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] px-3 text-[#141210] outline-none transition focus:border-[#7A6B56] focus:ring-2 focus:ring-[#B29F86]/30"
          />
        </label>
        {error && (
          <p className="mb-4 rounded-[8px] bg-[rgba(198,40,40,0.08)] px-3 py-2 text-sm font-medium text-[#C62828]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="h-11 w-full rounded-[8px] bg-[#141210] px-4 text-sm font-semibold text-[#FDFAF6] transition hover:bg-[#2A2520] disabled:opacity-50"
        >
          {isPending ? messages.login.loading : messages.login.submit}
        </button>
      </form>
    </div>
  );
}
