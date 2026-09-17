import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { makeKv } from "../helpers/kvStore.js";
import { setUserCapabilityOverrides } from "open-sse/providers/modelOverrides.js";

const capabilitiesKv = makeKv("modelCapabilities");
const OVERRIDES_FILE = path.join(DATA_DIR, "model-overrides.json");

let cachedOverrides = null;

async function syncOverridesToMemory() {
  cachedOverrides = await capabilitiesKv.getAll();
  setUserCapabilityOverrides(cachedOverrides);
  try {
    fs.mkdirSync(path.dirname(OVERRIDES_FILE), { recursive: true });
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(cachedOverrides, null, 2), "utf8");
  } catch (e) {
    console.warn("Failed to write model-overrides.json:", e?.message);
  }
  return cachedOverrides;
}

export async function getModelCapabilities() {
  if (cachedOverrides) return cachedOverrides;
  return await syncOverridesToMemory();
}

export async function getModelCapabilitiesForModel(key) {
  if (!key) return null;
  const all = await getModelCapabilities();
  return all[key] || null;
}

export async function updateModelCapabilities(key, capabilities) {
  if (!key || typeof key !== "string") throw new Error("model key required");
  const all = await getModelCapabilities();
  const prev = all[key] || {};
  const merged = { ...prev, ...capabilities };
  await capabilitiesKv.set(key, merged);
  return await syncOverridesToMemory();
}

export async function deleteModelCapabilities(key) {
  if (!key) return;
  await capabilitiesKv.remove(key);
  return await syncOverridesToMemory();
}

export async function initModelCapabilities() {
  return await syncOverridesToMemory();
}
