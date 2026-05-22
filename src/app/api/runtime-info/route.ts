import { NextResponse } from "next/server";

import { getRuntimeInfo } from "@/lib/ui-app/runtime-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getRuntimeInfo());
}
