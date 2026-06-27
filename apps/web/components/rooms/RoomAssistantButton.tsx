"use client";

import { useRouter } from "next/navigation";
import type { getRoomStepView } from "@/lib/steps/queries";
import { setAssistantSeed } from "@/lib/assistant/seed";

type View = Awaited<ReturnType<typeof getRoomStepView>>;

function buildPrompt(areaName: string, view: View): string {
  const ready = view.flags.readyToStart
    ? view.steps.find((s) => s.step_code === view.flags.readyToStart)?.name
    : null;
  const blocked = view.steps
    .filter((s) => s.status === "blocked" || s.status === "stalled")
    .map((s) => s.name);
  const procurement = view.steps
    .filter((s) => s.step_type === "procurement" && s.status === "not_started")
    .map((s) => s.name);
  return [
    `Bantu saya soal jadwal & langkah berikutnya untuk ruang "${areaName}".`,
    ready ? `Siap dimulai: ${ready}.` : null,
    blocked.length ? `Terblokir: ${blocked.join(", ")}.` : null,
    procurement.length ? `Perlu diorder (lead time): ${procurement.join(", ")}.` : null,
    `Apa urutan terbaik dan apa yang harus saya kerjakan/putuskan minggu ini?`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function RoomAssistantButton({
  areaName,
  view,
  projectCode,
}: {
  areaName: string;
  view: View;
  projectCode: string;
}) {
  const router = useRouter();
  function open() {
    const prompt = buildPrompt(areaName, view);
    setAssistantSeed(prompt);
    router.push(`/project/${projectCode}`);
  }
  return (
    <button
      type="button"
      onClick={open}
      className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] md:min-h-0"
    >
      Tanya asisten: jadwal &amp; langkah berikutnya
    </button>
  );
}
