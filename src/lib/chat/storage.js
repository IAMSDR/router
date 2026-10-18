// On-disk image storage for the Chat page (fork addition).
//
// Bytes live under <DATA_DIR>/chat-uploads/<sessionId>/<id>.<ext>. The database
// only ever holds the relative path (see chatAttachments.relPath); this module
// is the single place that turns that relative path back into an absolute path
// and guarantees the result cannot escape the uploads directory.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const CHAT_UPLOADS_DIR = path.join(DATA_DIR, "chat-uploads");

/** Create the uploads base directory if missing. Returns its absolute path. */
export function ensureChatUploadsDir() {
  if (!fs.existsSync(CHAT_UPLOADS_DIR)) fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });
  return CHAT_UPLOADS_DIR;
}

/**
 * Build the stored relative path for an attachment.
 * `ext` is expected without a leading dot; a stray leading dot is stripped so
 * callers passing ".png" and "png" produce the same path.
 */
export function relPathFor(sessionId, id, ext) {
  const cleanExt = String(ext ?? "").replace(/^\.+/, "");
  return `${sessionId}/${id}.${cleanExt}`;
}

/**
 * Resolve a relative path to an absolute path inside CHAT_UPLOADS_DIR.
 * Returns null (never throws) when the path is empty, not a string, or would
 * resolve outside the base directory (e.g. "../x", "sess/../../x", "/etc/passwd").
 */
export function chatUploadAbsPath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) return null;
  const base = path.resolve(CHAT_UPLOADS_DIR);
  const resolved = path.resolve(base, relPath);
  if (resolved === base) return null;
  if (!resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

/**
 * Persist an upload buffer to <DATA_DIR>/chat-uploads/<sessionId>/<id>.<ext>.
 * Throws when the derived path would escape the uploads directory.
 * Returns { relPath, size }.
 */
export function saveChatUpload({ sessionId, id, ext, buffer }) {
  const relPath = relPathFor(sessionId, id, ext);
  const abs = chatUploadAbsPath(relPath);
  if (!abs) throw new Error(`[chat/storage] unsafe upload path: ${relPath}`);
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return { relPath, size: buf.length };
}

/**
 * Delete the file at a relative path. Missing files are not an error.
 * Returns true when a file was removed, false otherwise (including an
 * escaping/empty relPath).
 */
export function deleteChatUploadFile(relPath) {
  const abs = chatUploadAbsPath(relPath);
  if (!abs) return false;
  try {
    if (!fs.existsSync(abs)) return false;
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** { count, bytes } over every file under the uploads dir; zeros if missing. */
export function getChatUploadsStats() {
  if (!fs.existsSync(CHAT_UPLOADS_DIR)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const file of walkFiles(CHAT_UPLOADS_DIR)) {
    try {
      bytes += fs.statSync(file).size;
      count += 1;
    } catch { /* file vanished mid-walk — skip */ }
  }
  return { count, bytes };
}

/**
 * Remove every file under the uploads dir, keeping the base directory itself
 * (empty session subdirectories are pruned too). Missing dir → zeros.
 * Returns { deletedFiles, bytes }.
 */
export function clearChatUploadsDir() {
  if (!fs.existsSync(CHAT_UPLOADS_DIR)) return { deletedFiles: 0, bytes: 0 };
  let deletedFiles = 0;
  let bytes = 0;
  for (const file of walkFiles(CHAT_UPLOADS_DIR)) {
    try {
      bytes += fs.statSync(file).size;
      fs.unlinkSync(file);
      deletedFiles += 1;
    } catch { /* best effort */ }
  }
  for (const entry of fs.readdirSync(CHAT_UPLOADS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { fs.rmSync(path.join(CHAT_UPLOADS_DIR, entry.name), { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return { deletedFiles, bytes };
}
