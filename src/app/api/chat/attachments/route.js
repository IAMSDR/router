// Dashboard Chat: image upload (fork addition).
//
// Bytes go to disk through src/lib/chat/storage.js and only the metadata row
// lives in SQLite. The attachment starts unlinked (messageId NULL); the
// messages route links it once the user sends the turn. Dimensions are read
// from the header when trivial, so no image library is needed.
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createChatAttachment } from "@/lib/db";
import { saveChatUpload, deleteChatUploadFile } from "@/lib/chat/storage.js";
import {
  CHAT_IMAGE_EXT,
  CHAT_MAX_UPLOAD_BYTES,
  CHAT_UPLOAD_BODY_LIMIT_BYTES,
  attachmentUrl,
  readImageSize,
} from "../_helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  // Refuse an over-large body before request.formData() buffers it. A missing
  // Content-Length reads as 0 (chunked uploads) and falls through to the
  // per-file check below.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > CHAT_UPLOAD_BODY_LIMIT_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large. Images are limited to 5 MB." },
      { status: 413 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  const sessionId = form.get("sessionId");

  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const mimeType = file.type;
  const ext = CHAT_IMAGE_EXT[mimeType];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image type. Use PNG, JPEG, WebP or GIF." },
      { status: 400 }
    );
  }
  if (file.size > CHAT_MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Image is too large. The limit is 5 MB." },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The uploaded image is empty." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const id = uuidv4();
  const filename = typeof file.name === "string" && file.name ? file.name : `${id}.${ext}`;
  const { width, height } = readImageSize(buffer, mimeType);

  let saved;
  try {
    saved = saveChatUpload({ sessionId, id, ext, buffer });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to store upload" },
      { status: 400 }
    );
  }

  try {
    await createChatAttachment({
      id,
      sessionId,
      messageId: null,
      filename,
      mimeType,
      size: saved.size,
      relPath: saved.relPath,
      width,
      height,
    });
  } catch (error) {
    // The bytes are already on disk; a failed row insert must not leave them
    // orphaned forever.
    try {
      deleteChatUploadFile(saved.relPath);
    } catch {
      // best effort
    }
    return NextResponse.json(
      { error: error?.message || "Failed to store attachment" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      attachment: {
        id,
        filename,
        mimeType,
        size: saved.size,
        width,
        height,
        url: attachmentUrl(id),
      },
    },
    { status: 201 }
  );
}
