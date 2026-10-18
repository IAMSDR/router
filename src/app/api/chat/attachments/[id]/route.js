// Dashboard Chat: serve an attachment's bytes (fork addition).
//
// The relative path from the DB is resolved through chatUploadAbsPath(), which
// refuses anything that would escape the uploads directory. The row is looked
// up first so a missing row and a missing file both read as 404, then the bytes
// are streamed. The stored mime type is only echoed when it is one the uploader
// accepts: a row planted by an import could otherwise serve text/html or
// image/svg+xml as active content at the gateway's origin, so anything else is
// downgraded to application/octet-stream (with nosniff).
import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getChatAttachment } from "@/lib/db";
import { chatUploadAbsPath } from "@/lib/chat/storage.js";
import { CHAT_IMAGE_EXT } from "../../_helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const attachment = await getChatAttachment(id);
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const absPath = chatUploadAbsPath(attachment.relPath);
  if (!absPath || !fs.existsSync(absPath)) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const contentType = CHAT_IMAGE_EXT[attachment.mimeType]
    ? attachment.mimeType
    : "application/octet-stream";

  // A read stream that errors after headers (e.g. the file vanished in the
  // existsSync→createReadStream gap) errors the web stream, which ends the
  // response instead of hanging.
  return new Response(Readable.toWeb(fs.createReadStream(absPath)), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

