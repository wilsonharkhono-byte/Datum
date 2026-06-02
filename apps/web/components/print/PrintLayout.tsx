import type { ReactNode } from "react";

export function PrintLayout({
  projectCode,
  projectName,
  title,
  subtitle,
  children,
}: {
  projectCode: string;
  projectName: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const today = new Date().toLocaleDateString("id-ID", {
    year: "numeric", month: "long", day: "numeric",
  });
  return (
    <div className="print-page mx-auto max-w-4xl bg-white p-8 text-stone-900">
      {/* Document header — visible on screen and in print */}
      <header className="border-b border-stone-300 pb-3">
        <div className="flex items-baseline justify-between text-[10pt] uppercase tracking-[0.16em] text-stone-500">
          <span>WHAstudio · DATUM</span>
          <span>{today}</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold leading-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-stone-600">{subtitle}</p>
        ) : null}
        <p className="mt-1 text-xs uppercase tracking-wide text-stone-500">
          {projectCode} · {projectName}
        </p>
      </header>

      <main className="mt-6">{children}</main>

      <footer className="mt-12 border-t border-stone-300 pt-2 text-[9pt] text-stone-500 print-only">
        DATUM internal — {projectCode} · dicetak {today}
      </footer>
    </div>
  );
}
