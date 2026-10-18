// Shared helpers for the dashboard Chat routes (fork addition).
//
// The messages/completions/attachments routes all need to describe an
// attachment to the browser (a public URL) and the upload route sniffs image
// dimensions from the file header. Keeping both here means every route agrees
// on the shape and nobody reaches for an image-processing dependency.

/** Image mime types the Chat uploader accepts, mapped to their file extension. */
export const CHAT_IMAGE_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Hard cap on an uploaded image, matching the client-side validation. */
export const CHAT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Early bound on the whole multipart request body. A 5 MB image plus multipart
 * boundaries/headers stays well under this; anything larger is refused before
 * request.formData() buffers it into memory.
 */
export const CHAT_UPLOAD_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

/** Where the bytes of an attachment can be fetched from. */
export function attachmentUrl(id) {
  return `/api/chat/attachments/${id}`;
}

/**
 * Return a shallow copy of a message whose attachment refs each carry the
 * public `url`. Persisted refs deliberately omit the url; the browser adds
 * nothing, so every read path funnels through here.
 */
export function withAttachmentUrls(message) {
  if (!message) return message;
  const attachments = Array.isArray(message.content?.attachments)
    ? message.content.attachments
    : [];
  return {
    ...message,
    content: {
      ...message.content,
      attachments: attachments.map((attachment) =>
        attachment && attachment.id && !attachment.url
          ? { ...attachment, url: attachmentUrl(attachment.id) }
          : attachment
      ),
    },
  };
}

/**
 * Read intrinsic dimensions straight from a PNG/JPEG/GIF header. Returns
 * { width: null, height: null } for anything else (WebP, unknown or malformed
 * buffers) instead of pulling in an image library just for a thumbnail hint.
 */
export function readImageSize(buffer, mimeType) {
  try {
    if (!buffer || buffer.length < 10) return { width: null, height: null };
    if (mimeType === "image/png") return readPngSize(buffer);
    if (mimeType === "image/jpeg") return readJpegSize(buffer);
    if (mimeType === "image/gif") return readGifSize(buffer);
  } catch {
    // A truncated/garbage header simply means "we don't know".
  }
  return { width: null, height: null };
}

function readPngSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 24) return { width: null, height: null };
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return { width: null, height: null };
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readGifSize(buffer) {
  const header = buffer.toString("ascii", 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return { width: null, height: null };
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function readJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { width: null, height: null };
  }
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // Standalone markers carry no length payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    // SOF0..SOF15 hold the frame dimensions; DHT/JPG/DAC are not frame headers.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buffer.length) return { width: null, height: null };
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return { width: null, height: null };
}
