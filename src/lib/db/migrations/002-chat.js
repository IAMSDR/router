// Chat page (fork addition): create the chat sessions/messages/attachments
// tables and their indexes. Same declarative shape as 001-initial.js; it only
// covers the tables added at version 2 so older DBs pick them up in place.
// IF NOT EXISTS keeps it idempotent with the additive auto-sync on boot.
import { TABLES, buildCreateTableSql } from "../schema.js";

const ADDED_TABLES = ["chatSessions", "chatMessages", "chatAttachments"];

export default {
  version: 2,
  name: "chat",
  up(db) {
    for (const name of ADDED_TABLES) {
      const def = TABLES[name];
      db.exec(buildCreateTableSql(name, def));
      for (const idx of def.indexes || []) db.exec(idx);
    }
  },
};
