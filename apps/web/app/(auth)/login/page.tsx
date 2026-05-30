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
    <form
      action={handleSubmit}
      className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-8 shadow-sm"
    >
      <h1 className="mb-6 text-2xl font-semibold text-stone-900">{messages.login.title}</h1>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-stone-700">{messages.login.email}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </label>
      <label className="mb-6 block">
        <span className="mb-1 block text-sm text-stone-700">{messages.login.password}</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </label>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? messages.login.loading : messages.login.submit}
      </button>
    </form>
  );
}
