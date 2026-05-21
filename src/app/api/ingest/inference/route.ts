import { NextResponse } from "next/server";

import { persistInferenceEvent } from "@/lib/server/ingestion";
import { inferenceEventSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = inferenceEventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid inference payload.",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const inferenceLog = await persistInferenceEvent(parsed.data);
  return NextResponse.json(
    {
      ok: true,
      inferenceLogId: inferenceLog.id,
    },
    { status: 201 },
  );
}
