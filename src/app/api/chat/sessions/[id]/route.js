// Dashboard Chat: one session — read, patch and delete (fork addition).
//
// Next 16 hands dynamic params in as a promise, so `id` is awaited. Deletion
// also unlinks image bytes from disk; the repo returns only the stored relPaths
// because it never touches the filesystem itself.
import { NextResponse } from "next/server";
import {
  getChatSession,
  listChatMessages,
  updateChatSession,
  deleteChatSession,
} from "@/lib/db";
import { deleteChatUploadFile } from "@/lib/chat/storage.js";
import { withAttachmentUrls } from "../../_helpers.js";

export const dynamic = "force-dynamic";

// Only these four fields are editable on a session.
const PATCHABLE_FIELDS = ["title", "model", "systemPrompt", "params"];

export async function GET(request, { params }) {
  const { id } = await params;
  const session = await getChatSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const messages = (await listChatMessages(id)).map(withAttachmentUrls);
  return NextResponse.json({ session, messages });
}

export async function PATCH(request, { params }) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const patch = {};
  for (const field of PATCHABLE_FIELDS) {
    if (body[field] !== undefined) patch[field] = body[field];
  }

  const session = await updateChatSession(id, patch);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const { relPaths } = await deleteChatSession(id);

  // Best effort: a failure to unlink a file must not fail the delete.
  for (const relPath of relPaths || []) {
    try {
      deleteChatUploadFile(relPath);
    } catch {
      // ignore — the row is already gone
    }
  }

  return NextResponse.json({ success: true });
}
