import { NextResponse } from "next/server";

import {
  enqueueInferenceEvent,
  scheduleInferenceEventProcessing,
} from "@/lib/server/ingestion";
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

  const enqueueResult = await enqueueInferenceEvent(parsed.data);
  scheduleInferenceEventProcessing();

  return NextResponse.json(
    {
      ok: true,
      eventId: enqueueResult.eventId,
      enqueued: enqueueResult.enqueued,
    },
    { status: 202 },
  );
}
