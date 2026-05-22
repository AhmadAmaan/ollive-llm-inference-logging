import { NextResponse } from "next/server";

import { createConversation, listConversations } from "@/lib/ui-app/conversations";
import { createConversationSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  const body = request.headers.get("content-length")
    ? await request.json()
    : {};
  const parsed = createConversationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid conversation payload." },
      { status: 400 },
    );
  }

  const conversation = await createConversation(parsed.data.title);
  return NextResponse.json({ conversation }, { status: 201 });
}
