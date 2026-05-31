import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#D2D0C4] px-4 py-6 text-[#141210] sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-6xl items-center justify-center">
        {children}
      </div>
    </div>
  );
}
