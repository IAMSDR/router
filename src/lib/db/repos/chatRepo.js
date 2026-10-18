// Chat persistence (fork addition) — sessions, messages and image attachment
// metadata for the dashboard Chat page. Written against the same conventions
// as combosRepo.js: getAdapter(), db.all/get/run, db.transaction, uuid ids and
// ISO timestamp strings. `params` and message `content` are stored as JSON TEXT
// through the shared jsonCol helpers.
//
// Message `content` is the object { text, attachments }. `attachments` holds
// { id, filename, mimeType, width, height } refs and is resolved from the
// chatAttachments rows on read; the JSON copy is only a fallback for messages
// whose refs were never (or no longer) persisted as rows.
//
// This module never touches the filesystem: delete helpers return the removed
// attachment relPaths so the caller can unlink the bytes from disk.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function nowIso() {
  return new Date().toISOString();
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    systemPrompt: row.systemPrompt,
    params: parseJson(row.params, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Coerce a caller-supplied content value into the canonical { text, attachments }.
function normalizeContent(content) {
  if (typeof content === "string") return { text: content, attachments: [] };
  if (content && typeof content === "object") {
    return {
      text: typeof content.text === "string" ? content.text : "",
      attachments: Array.isArray(content.attachments) ? content.attachments : [],
    };
  }
  return { text: "", attachments: [] };
}

function previewFromContent(raw) {
  const parsed = parseJson(raw, null);
  const text = typeof parsed?.text === "string" ? parsed.text : (typeof parsed === "string" ? parsed : "");
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

function attachmentRef(row) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
  };
}

function rowToAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    messageId: row.messageId,
    sessionId: row.sessionId,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    relPath: row.relPath,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
  };
}

function messageToClient(row, attachments) {
  if (!row) return null;
  const stored = normalizeContent(parseJson(row.content, null));
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: {
      text: stored.text,
      attachments: attachments && attachments.length ? attachments : stored.attachments,
    },
    reasoning: row.reasoning,
    model: row.model,
    provider: row.provider,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    cost: row.cost,
    ttftMs: row.ttftMs,
    latencyMs: row.latencyMs,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
  };
}

function attachmentsForMessage(db, messageId) {
  if (!messageId) return [];
  return db
    .all(`SELECT * FROM chatAttachments WHERE messageId = ? ORDER BY createdAt ASC, rowid ASC`, [messageId])
    .map(attachmentRef);
}

// ─── Sessions ────────────────────────────────────────────────────────────

export async function listChatSessions() {
  const db = await getAdapter();
  const rows = db.all(`
    SELECT s.*,
      (SELECT COUNT(*) FROM chatMessages m WHERE m.sessionId = s.id) AS messageCount,
      (SELECT m.content FROM chatMessages m WHERE m.sessionId = s.id ORDER BY m.createdAt DESC, m.rowid DESC LIMIT 1) AS lastContent,
      (SELECT m.createdAt FROM chatMessages m WHERE m.sessionId = s.id ORDER BY m.createdAt DESC, m.rowid DESC LIMIT 1) AS lastMessageAt
    FROM chatSessions s
    ORDER BY s.updatedAt DESC, s.rowid DESC
  `);
  return rows.map((row) => ({
    ...rowToSession(row),
    messageCount: row.messageCount ?? 0,
    lastMessagePreview: previewFromContent(row.lastContent),
    lastMessageAt: row.lastMessageAt ?? null,
  }));
}

export async function getChatSession(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM chatSessions WHERE id = ?`, [id]);
  return rowToSession(row);
}

export async function createChatSession(data = {}) {
  const db = await getAdapter();
  const now = nowIso();
  const session = {
    id: uuidv4(),
    title: data.title ?? "New chat",
    model: data.model ?? null,
    systemPrompt: data.systemPrompt ?? "",
    params: data.params ?? {},
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO chatSessions(id, title, model, systemPrompt, params, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [session.id, session.title, session.model, session.systemPrompt, stringifyJson(session.params), session.createdAt, session.updatedAt]
  );
  return session;
}

export async function updateChatSession(id, patch = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM chatSessions WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToSession(row);
    const next = {
      // Only these four are patchable; everything else stays as stored.
      title: patch.title !== undefined ? patch.title : current.title,
      model: patch.model !== undefined ? patch.model : current.model,
      systemPrompt: patch.systemPrompt !== undefined ? patch.systemPrompt : current.systemPrompt,
      params: patch.params !== undefined ? patch.params : current.params,
      updatedAt: nowIso(),
    };
    db.run(
      `UPDATE chatSessions SET title = ?, model = ?, systemPrompt = ?, params = ?, updatedAt = ? WHERE id = ?`,
      [next.title, next.model, next.systemPrompt, stringifyJson(next.params), next.updatedAt, id]
    );
    result = rowToSession(db.get(`SELECT * FROM chatSessions WHERE id = ?`, [id]));
  });
  return result;
}

/**
 * Delete a session with every message and attachment row it owns.
 * Returns { deleted, relPaths } where relPaths lists the attachment files the
 * caller must unlink from disk (this module does not touch the filesystem).
 */
export async function deleteChatSession(id) {
  const db = await getAdapter();
  let deleted = false;
  const relPaths = [];
  db.transaction(() => {
    const session = db.get(`SELECT id FROM chatSessions WHERE id = ?`, [id]);
    if (!session) return;

    const messageIds = db.all(`SELECT id FROM chatMessages WHERE sessionId = ?`, [id]).map((r) => r.id);
    let rows;
    if (messageIds.length) {
      const ph = messageIds.map(() => "?").join(",");
      rows = db.all(`SELECT id, relPath FROM chatAttachments WHERE sessionId = ? OR messageId IN (${ph})`, [id, ...messageIds]);
    } else {
      rows = db.all(`SELECT id, relPath FROM chatAttachments WHERE sessionId = ?`, [id]);
    }
    for (const r of rows) if (r.relPath) relPaths.push(r.relPath);
    if (rows.length) {
      const ph = rows.map(() => "?").join(",");
      db.run(`DELETE FROM chatAttachments WHERE id IN (${ph})`, rows.map((r) => r.id));
    }

    db.run(`DELETE FROM chatMessages WHERE sessionId = ?`, [id]);
    const res = db.run(`DELETE FROM chatSessions WHERE id = ?`, [id]);
    deleted = (res?.changes ?? 0) > 0;
  });
  return { deleted, relPaths };
}

// ─── Messages ────────────────────────────────────────────────────────────

export async function listChatMessages(sessionId) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM chatMessages WHERE sessionId = ? ORDER BY createdAt ASC, rowid ASC`, [sessionId]);
  if (!rows.length) return [];

  const ph = rows.map(() => "?").join(",");
  const attRows = db.all(
    `SELECT * FROM chatAttachments WHERE messageId IN (${ph}) ORDER BY createdAt ASC, rowid ASC`,
    rows.map((r) => r.id)
  );
  const byMessage = new Map();
  for (const a of attRows) {
    if (!a.messageId) continue;
    if (!byMessage.has(a.messageId)) byMessage.set(a.messageId, []);
    byMessage.get(a.messageId).push(attachmentRef(a));
  }
  return rows.map((row) => messageToClient(row, byMessage.get(row.id) || []));
}

export async function appendChatMessage(data = {}) {
  const db = await getAdapter();
  const now = nowIso();
  const message = {
    id: uuidv4(),
    sessionId: data.sessionId,
    role: data.role ?? "user",
    content: normalizeContent(data.content),
    reasoning: data.reasoning ?? null,
    model: data.model ?? null,
    provider: data.provider ?? null,
    promptTokens: data.promptTokens ?? null,
    completionTokens: data.completionTokens ?? null,
    cost: data.cost ?? null,
    ttftMs: data.ttftMs ?? null,
    latencyMs: data.latencyMs ?? null,
    status: data.status ?? null,
    error: data.error ?? null,
    createdAt: now,
  };
  db.transaction(() => {
    db.run(
      `INSERT INTO chatMessages(id, sessionId, role, content, reasoning, model, provider, promptTokens, completionTokens, cost, ttftMs, latencyMs, status, error, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id, message.sessionId, message.role, stringifyJson(message.content),
        message.reasoning, message.model, message.provider,
        message.promptTokens, message.completionTokens, message.cost,
        message.ttftMs, message.latencyMs, message.status, message.error, message.createdAt,
      ]
    );
    db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [now, message.sessionId]);
  });
  return messageToClient(db.get(`SELECT * FROM chatMessages WHERE id = ?`, [message.id]), []);
}

export async function updateChatMessage(id, patch = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM chatMessages WHERE id = ?`, [id]);
    if (!row) return;
    const next = {
      role: patch.role !== undefined ? patch.role : row.role,
      content: patch.content !== undefined ? normalizeContent(patch.content) : normalizeContent(parseJson(row.content, null)),
      reasoning: patch.reasoning !== undefined ? patch.reasoning : row.reasoning,
      model: patch.model !== undefined ? patch.model : row.model,
      provider: patch.provider !== undefined ? patch.provider : row.provider,
      promptTokens: patch.promptTokens !== undefined ? patch.promptTokens : row.promptTokens,
      completionTokens: patch.completionTokens !== undefined ? patch.completionTokens : row.completionTokens,
      cost: patch.cost !== undefined ? patch.cost : row.cost,
      ttftMs: patch.ttftMs !== undefined ? patch.ttftMs : row.ttftMs,
      latencyMs: patch.latencyMs !== undefined ? patch.latencyMs : row.latencyMs,
      status: patch.status !== undefined ? patch.status : row.status,
      error: patch.error !== undefined ? patch.error : row.error,
    };
    db.run(
      `UPDATE chatMessages SET role = ?, content = ?, reasoning = ?, model = ?, provider = ?, promptTokens = ?, completionTokens = ?, cost = ?, ttftMs = ?, latencyMs = ?, status = ?, error = ? WHERE id = ?`,
      [
        next.role, stringifyJson(next.content), next.reasoning, next.model, next.provider,
        next.promptTokens, next.completionTokens, next.cost, next.ttftMs, next.latencyMs,
        next.status, next.error, id,
      ]
    );
    result = messageToClient(db.get(`SELECT * FROM chatMessages WHERE id = ?`, [id]), attachmentsForMessage(db, id));
  });
  return result;
}

export async function deleteChatMessage(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM chatMessages WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Delete a message and every later one in its session (edit-and-resend
 * truncation). Returns { deleted, relPaths }: the number of messages removed
 * plus the attachment files the caller must unlink from disk.
 */
export async function deleteChatMessagesFrom(sessionId, messageId) {
  const db = await getAdapter();
  let deleted = 0;
  const relPaths = [];
  db.transaction(() => {
    const target = db.get(`SELECT rowid AS rid, createdAt FROM chatMessages WHERE id = ? AND sessionId = ?`, [messageId, sessionId]);
    if (!target) return;
    const doomed = db.all(
      `SELECT id FROM chatMessages WHERE sessionId = ? AND (createdAt > ? OR (createdAt = ? AND rowid >= ?))`,
      [sessionId, target.createdAt, target.createdAt, target.rid]
    );
    if (!doomed.length) return;
    const ids = doomed.map((r) => r.id);
    const ph = ids.map(() => "?").join(",");
    for (const a of db.all(`SELECT relPath FROM chatAttachments WHERE messageId IN (${ph})`, ids)) {
      if (a.relPath) relPaths.push(a.relPath);
    }
    db.run(`DELETE FROM chatAttachments WHERE messageId IN (${ph})`, ids);
    const res = db.run(`DELETE FROM chatMessages WHERE id IN (${ph})`, ids);
    deleted = res?.changes ?? 0;
  });
  return { deleted, relPaths };
}

// ─── Attachments (metadata only; bytes live on disk) ──────────────────────

export async function createChatAttachment(data = {}) {
  const db = await getAdapter();
  const attachment = {
    id: data.id ?? uuidv4(),
    messageId: data.messageId ?? null,
    sessionId: data.sessionId ?? null,
    filename: data.filename ?? null,
    mimeType: data.mimeType ?? null,
    size: data.size ?? null,
    relPath: data.relPath ?? null,
    width: data.width ?? null,
    height: data.height ?? null,
    createdAt: nowIso(),
  };
  db.run(
    `INSERT INTO chatAttachments(id, messageId, sessionId, filename, mimeType, size, relPath, width, height, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attachment.id, attachment.messageId, attachment.sessionId, attachment.filename,
      attachment.mimeType, attachment.size, attachment.relPath, attachment.width,
      attachment.height, attachment.createdAt,
    ]
  );
  return attachment;
}

export async function getChatAttachment(id) {
  const db = await getAdapter();
  return rowToAttachment(db.get(`SELECT * FROM chatAttachments WHERE id = ?`, [id]));
}

export async function listChatAttachments(sessionId) {
  const db = await getAdapter();
  return db
    .all(`SELECT * FROM chatAttachments WHERE sessionId = ? ORDER BY createdAt ASC, rowid ASC`, [sessionId])
    .map(rowToAttachment);
}

/**
 * Link previously-uploaded (unlinked) attachments to a message. Only rows in
 * the same session with a NULL messageId are touched, so an already-linked
 * attachment is never re-pointed; unknown/foreign ids are ignored silently.
 * Empty attachmentIds returns 0 without touching the DB.
 */
export async function linkChatAttachmentsToMessage({ sessionId, messageId, attachmentIds }) {
  const db = await getAdapter();
  const ids = Array.isArray(attachmentIds) ? attachmentIds.filter((id) => id != null) : [];
  if (!ids.length) return 0;
  let linked = 0;
  db.transaction(() => {
    const ph = ids.map(() => "?").join(",");
    const res = db.run(
      `UPDATE chatAttachments SET messageId = ? WHERE sessionId = ? AND messageId IS NULL AND id IN (${ph})`,
      [messageId, sessionId, ...ids]
    );
    linked = res?.changes ?? 0;
  });
  return linked;
}

export async function deleteChatAttachment(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM chatAttachments WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/** Delete every attachment row of a session. Returns { deleted, relPaths }. */
export async function deleteChatAttachmentsBySession(sessionId) {
  const db = await getAdapter();
  let deleted = 0;
  const relPaths = [];
  db.transaction(() => {
    const rows = db.all(`SELECT relPath FROM chatAttachments WHERE sessionId = ?`, [sessionId]);
    for (const r of rows) if (r.relPath) relPaths.push(r.relPath);
    const res = db.run(`DELETE FROM chatAttachments WHERE sessionId = ?`, [sessionId]);
    deleted = res?.changes ?? 0;
  });
  return { deleted, relPaths };
}

/** Delete every attachment row of a message. Returns { deleted, relPaths }. */
export async function deleteChatAttachmentsByMessage(messageId) {
  const db = await getAdapter();
  let deleted = 0;
  const relPaths = [];
  db.transaction(() => {
    const rows = db.all(`SELECT relPath FROM chatAttachments WHERE messageId = ?`, [messageId]);
    for (const r of rows) if (r.relPath) relPaths.push(r.relPath);
    const res = db.run(`DELETE FROM chatAttachments WHERE messageId = ?`, [messageId]);
    deleted = res?.changes ?? 0;
  });
  return { deleted, relPaths };
}

/**
 * Delete every attachment row (all sessions). Returns { deleted, relPaths }.
 * Also blanks every message's stored content.attachments refs so the read-time
 * fallback cannot hand out paths to now-deleted files; content.text is kept.
 */
export async function clearAllChatAttachments() {
  const db = await getAdapter();
  let deleted = 0;
  const relPaths = [];
  db.transaction(() => {
    for (const r of db.all(`SELECT relPath FROM chatAttachments`)) {
      if (r.relPath) relPaths.push(r.relPath);
    }
    const res = db.run(`DELETE FROM chatAttachments`);
    deleted = res?.changes ?? 0;
    for (const row of db.all(`SELECT id, content FROM chatMessages WHERE content IS NOT NULL`)) {
      const parsed = parseJson(row.content, null);
      if (!parsed || typeof parsed !== "object") continue;
      if (!Array.isArray(parsed.attachments) || parsed.attachments.length === 0) continue;
      db.run(`UPDATE chatMessages SET content = ? WHERE id = ?`, [stringifyJson({ ...parsed, attachments: [] }), row.id]);
    }
  });
  return { deleted, relPaths };
}

export async function countChatAttachments(sessionId) {
  const db = await getAdapter();
  const row = sessionId
    ? db.get(`SELECT COUNT(*) AS c FROM chatAttachments WHERE sessionId = ?`, [sessionId])
    : db.get(`SELECT COUNT(*) AS c FROM chatAttachments`);
  return row?.c ?? 0;
}
