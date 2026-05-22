import { NextResponse } from "next/server";

import { getDashboardMetrics } from "@/lib/ui-app/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const metrics = await getDashboardMetrics();
  return NextResponse.json(metrics);
}
