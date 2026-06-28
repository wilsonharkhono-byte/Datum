import type { ReactNode } from "react";
import { AssistantProvider } from "@/components/chat/AssistantProvider";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <AssistantProvider>{children}</AssistantProvider>;
}
