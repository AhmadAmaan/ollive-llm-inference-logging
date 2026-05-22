import { NextResponse } from "next/server";

import { getMetricsOverview } from "@/lib/ui-app/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const metrics = await getMetricsOverview();
  return NextResponse.json(metrics);
}
