// Dashboard Chat: append a message to a session (fork addition).
//
// Uploaded images arrive as unlinked chatAttachments rows (messageId NULL).
// The message row is created first, then linkChatAttachmentsToMessage() points
// those rows at it, and the message's stored content is rewritten with the
// resulting refs so a later read can rebuild the conversation without a join.
import { NextResponse } from "next/server";
import {
  getChatSession,
  appendChatMessage,
  updateChatMessage,
  linkChatAttachmentsToMessage,
  listChatAttachments,
} from "@/lib/db";
import { withAttachmentUrls } from "../../../_helpers.js";

export const dynamic = "force-dynamic";

function attachmentRef(row) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
  };
}

export async function POST(request, { params }) {
  const { id: sessionId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  // Unknown session is a 400 here (the client addresses the session in the
  // path and may have just deleted it), not a 404.
  const session = await getChatSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 400 });
  }

  const role = body?.role;
  const text = typeof body?.content?.text === "string" ? body.content.text : "";
  const attachmentIds = Array.isArray(body?.content?.attachmentIds)
    ? body.content.attachmentIds
    : [];

  if (role !== "user" && role !== "assistant") {
    return NextResponse.json(
      { error: 'role must be "user" or "assistant"' },
      { status: 400 }
    );
  }
  if (!text.trim() && attachmentIds.length === 0) {
    return NextResponse.json(
      { error: "A message needs text or at least one attachment" },
      { status: 400 }
    );
  }

  const created = await appendChatMessage({
    sessionId,
    role,
    content: { text, attachments: [] },
  });

  await linkChatAttachmentsToMessage({
    sessionId,
    messageId: created.id,
    attachmentIds,
  });

  // Resolve the refs from the rows that actually linked (unknown/foreign ids
  // are ignored by the repo) and pin them into the stored content.
  const refs = (await listChatAttachments(sessionId))
    .filter((attachment) => attachment.messageId === created.id)
    .map(attachmentRef);
  const stored = await updateChatMessage(created.id, {
    content: { text, attachments: refs },
  });
  const message = stored || { ...created, content: { text, attachments: refs } };

  return NextResponse.json({ message: withAttachmentUrls(message) }, { status: 201 });
}
