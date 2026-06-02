import { NextResponse } from "next/server";
import { getCardNextDeadline } from "@/lib/gates/schedule";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await params;
  const deadline = await getCardNextDeadline(cardId);
  if (!deadline) return NextResponse.json(null);
  return NextResponse.json(deadline);
}
