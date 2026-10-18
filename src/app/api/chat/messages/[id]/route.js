// Dashboard Chat: delete a single message and its attachment rows (fork
// addition).
//
// The message row is removed first: a 404 must not destroy attachments for a
// message that is not there. Only then are the message's attachment rows
// deleted and their bytes unlinked (best effort — a failed unlink never fails
// the request). Clients that still send a `sessionId` are harmless; the field
// is ignored because deleteChatAttachmentsByMessage() scopes by message.
import { NextResponse } from "next/server";
import { deleteChatMessage, deleteChatAttachmentsByMessage } from "@/lib/db";
import { deleteChatUploadFile } from "@/lib/chat/storage.js";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const { id } = await params;

  const deleted = await deleteChatMessage(id);
  if (!deleted) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const { relPaths } = await deleteChatAttachmentsByMessage(id);
  for (const relPath of relPaths || []) {
    try {
      deleteChatUploadFile(relPath);
    } catch {
      // best effort — the rows are already gone
    }
  }

  return NextResponse.json({ success: true });
}
