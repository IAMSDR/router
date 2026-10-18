// Dashboard Chat: truncate a conversation from a message onward (fork
// addition). Used by edit-and-resend and regenerate: the message with `id` and
// everything after it is removed. `sessionId` comes from the JSON body (or
// ?sessionId=) because the chatMessages row is scoped to a session.
import { NextResponse } from "next/server";
import { deleteChatMessagesFrom } from "@/lib/db";
import { deleteChatUploadFile } from "@/lib/chat/storage.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { id } = await params;

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const sessionId = body?.sessionId || new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const { relPaths } = await deleteChatMessagesFrom(sessionId, id);
  for (const relPath of relPaths || []) {
    try {
      deleteChatUploadFile(relPath);
    } catch {
      // best effort — the rows are already gone
    }
  }

  return NextResponse.json({ success: true });
}
