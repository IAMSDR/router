// Chat image cache maintenance (fork addition).
//
// The Chat page stores attached image bytes on disk under
// <DATA_DIR>/chat-uploads, while the database only holds one chatAttachments
// row per file (pointing at the stored relative path). The files and the rows
// must be cleared together: deleting only the files leaves rows whose paths
// point at nothing, and deleting only the rows leaves orphaned bytes. Either
// way, conversations would show images whose files are gone.
import { NextResponse } from "next/server";
import { getChatUploadsStats, clearChatUploadsDir } from "@/lib/chat/storage.js";
import { clearAllChatAttachments } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Files-on-disk stats (not database rows).
export async function GET() {
  try {
    const { count, bytes } = await getChatUploadsStats();
    return NextResponse.json({ count, bytes }, { headers: CACHE_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error reading chat cache stats:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Clear the on-disk bytes and the attachment rows in one action.
export async function DELETE() {
  try {
    const { deletedFiles, bytes } = clearChatUploadsDir();
    const { deleted: deletedRows } = await clearAllChatAttachments();
    return NextResponse.json(
      { deletedFiles, bytes, deletedRows },
      { headers: CACHE_RESPONSE_HEADERS }
    );
  } catch (error) {
    console.log("Error clearing chat cache:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
