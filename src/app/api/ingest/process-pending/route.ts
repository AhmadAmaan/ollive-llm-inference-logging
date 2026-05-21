import { NextResponse } from "next/server";

import { processPendingInferenceEvents } from "@/lib/server/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await processPendingInferenceEvents();
  return NextResponse.json(result);
}
