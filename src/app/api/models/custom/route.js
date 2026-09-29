import { NextResponse } from "next/server";
import * as modelsDb from "@/models";
import { CAPACITY_META, isSttTransport } from "@/shared/constants/models";

const getCustomModels = modelsDb.getCustomModels;
const addCustomModel = modelsDb.addCustomModel;
const addCustomModelsBatch = modelsDb.addCustomModelsBatch;
const deleteCustomModel = modelsDb.deleteCustomModel;
const deleteCustomModels = modelsDb.deleteCustomModels;

export const dynamic = "force-dynamic";

// Whitelist capability keys to boolean values — ignore anything else
function sanitizeCaps(caps) {
  if (!caps || typeof caps !== "object") return null;
  const clean = {};
  for (const key of Object.keys(CAPACITY_META)) {
    if (typeof caps[key] === "boolean") clean[key] = caps[key];
  }
  return Object.keys(clean).length ? clean : null;
}

// Accepted STT transport markers live in the shared whitelist
// (src/shared/constants/models STT_TRANSPORT_META) — the dashboard transport
// select and this validator must agree on one set, so neither owns a copy.
// Unknown or mistyped values are silently dropped, the same policy
// sanitizeCaps applies to capability keys.
function sanitizeTransport(transport, type) {
  if (type !== "stt" || !isSttTransport(transport)) return null;
  return transport.trim();
}

// GET /api/models/custom - List all custom models
export async function GET() {
  try {
    const models = await getCustomModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

// POST /api/models/custom - Add custom model (single or batch)
export async function POST(request) {
  try {
    const body = await request.json();
    const { providerAlias, type = "llm" } = body;
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }

    if (Array.isArray(body.models)) {
      const cleanModels = body.models
        .map((m) => {
          const modelId = typeof m === "string" ? m : m.id;
          if (!modelId) return null;
          const cleanCaps = sanitizeCaps(m.caps);
          const cleanTransport = sanitizeTransport(m.transport, type);
          return {
            id: modelId,
            name: m.name || modelId,
            ...(cleanCaps ? { caps: cleanCaps } : {}),
            ...(cleanTransport ? { transport: cleanTransport } : {}),
          };
        })
        .filter(Boolean);

      if (typeof addCustomModelsBatch === "function") {
        await addCustomModelsBatch({ providerAlias, models: cleanModels, type });
      } else {
        for (const m of cleanModels) {
          await addCustomModel({ providerAlias, id: m.id, type, name: m.name, caps: m.caps, transport: m.transport });
        }
      }
      return NextResponse.json({ success: true, count: cleanModels.length });
    }

    const { id, name, caps, transport } = body;
    if (!id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const cleanCaps = sanitizeCaps(caps);
    const cleanTransport = sanitizeTransport(transport, type || "llm");
    const added = await addCustomModel({
      providerAlias,
      id,
      type: type || "llm",
      name,
      ...(cleanCaps ? { caps: cleanCaps } : {}),
      ...(cleanTransport ? { transport: cleanTransport } : {}),
    });
    return NextResponse.json({ success: true, added });
  } catch (error) {
    console.log("Error adding custom model:", error);
    return NextResponse.json({ error: error.message || "Failed to add custom model" }, { status: 500 });
  }
}

// DELETE /api/models/custom?providerAlias=xxx&id=yyy&type=zzz or all=true or ids=a,b,c
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const idsParam = searchParams.get("ids");
    const all = searchParams.get("all") === "true";
    const type = searchParams.get("type") || "llm";

    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }

    if (all) {
      if (typeof deleteCustomModels === "function") {
        await deleteCustomModels({ providerAlias, all: true, type });
      } else {
        const allModels = await getCustomModels();
        const targets = allModels.filter(
          (m) => m.providerAlias === providerAlias && (!type || (m.kind || m.type || "llm") === type)
        );
        for (const m of targets) {
          await deleteCustomModel({ providerAlias, id: m.id, type });
        }
      }
      return NextResponse.json({ success: true });
    }

    if (idsParam) {
      const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (typeof deleteCustomModels === "function") {
        await deleteCustomModels({ providerAlias, ids, type });
      } else {
        for (const modelId of ids) {
          await deleteCustomModel({ providerAlias, id: modelId, type });
        }
      }
      return NextResponse.json({ success: true, count: ids.length });
    }

    if (!id) {
      return NextResponse.json({ error: "id, ids, or all=true required" }, { status: 400 });
    }

    await deleteCustomModel({ providerAlias, id, type });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting custom model:", error);
    return NextResponse.json({ error: error.message || "Failed to delete custom model" }, { status: 500 });
  }
}
