import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");
const mitmKv = makeKv("mitmAlias");

// modelAliases: key=alias, value=modelString
export async function getModelAliases() {
  return await aliasKv.getAll();
}

export async function setModelAlias(alias, model) {
  await aliasKv.set(alias, model);
}

export async function deleteModelAlias(alias) {
  await aliasKv.remove(alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll();
  return Object.values(all);
}

// Atomic upsert inside transaction to prevent duplicate races.
// Re-adding an existing model updates caps/name/transport without resetting omitted fields.
export async function addCustomModel({ providerAlias, id, type = "llm", name, caps, transport }) {
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) {
      const prev = parseJson(row.value) || {};
      const next = { ...prev, ...(name ? { name } : {}), ...(caps ? { caps } : {}), ...(transport ? { transport } : {}) };
      db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`, [stringifyJson(next), k]);
      return;
    }
    const value = stringifyJson({ providerAlias, id, type, name: name || id, ...(caps ? { caps } : {}), ...(transport ? { transport } : {}) });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

export async function addCustomModelsBatch({ providerAlias, models = [], type = "llm" }) {
  if (!providerAlias || !Array.isArray(models) || models.length === 0) return 0;
  const db = await getAdapter();
  let addedCount = 0;
  db.transaction(() => {
    for (const m of models) {
      const modelId = typeof m === "string" ? m : m.id;
      if (!modelId) continue;
      const k = customKey(providerAlias, modelId, type);
      const row = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
      if (row) {
        const prev = parseJson(row.value) || {};
        const next = {
          ...prev,
          ...(m.name ? { name: m.name } : {}),
          ...(m.caps ? { caps: m.caps } : {}),
          ...(m.transport ? { transport: m.transport } : {}),
        };
        db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`, [stringifyJson(next), k]);
      } else {
        const value = stringifyJson({
          providerAlias,
          id: modelId,
          type,
          name: m.name || modelId,
          ...(m.caps ? { caps: m.caps } : {}),
          ...(m.transport ? { transport: m.transport } : {}),
        });
        db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
        addedCount++;
      }
    }
  });
  return addedCount;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  await customKv.remove(customKey(providerAlias, id, type));
}

export async function deleteCustomModels({ providerAlias, ids, all = false, type = "llm" }) {
  if (!providerAlias) return;
  const db = await getAdapter();
  db.transaction(() => {
    if (all) {
      const rows = db.all(`SELECT key FROM kv WHERE scope = 'customModels'`);
      const prefix = `${providerAlias}|`;
      for (const r of rows) {
        if (typeof r.key === "string" && r.key.startsWith(prefix)) {
          if (!type || r.key.endsWith(`|${type}`)) {
            db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [r.key]);
          }
        }
      }
    } else if (Array.isArray(ids) && ids.length > 0) {
      for (const id of ids) {
        const k = customKey(providerAlias, id, type);
        db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
      }
    }
  });
}

// mitmAlias: key=toolName, value=mappings object
export async function getMitmAlias(toolName) {
  if (toolName) {
    const v = await mitmKv.get(toolName);
    return v || {};
  }
  return await mitmKv.getAll();
}

export async function setMitmAliasAll(toolName, mappings) {
  await mitmKv.set(toolName, mappings || {});
}
