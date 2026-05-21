import { NextResponse } from "next/server";

import { getMetricsOverview } from "@/lib/server/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const metrics = await getMetricsOverview();
  return NextResponse.json(metrics);
}
