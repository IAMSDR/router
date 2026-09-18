// Fork addition — REST API for a single API key's access policy.
//
// GET    /api/keys/[id]/policy  → current policy (or a default shell)
// PUT    /api/keys/[id]/policy  → create/replace the policy
// DELETE /api/keys/[id]/policy  → remove the policy (=> unrestricted)
//
// Absence of a policy means "unrestricted", so GET returns an empty policy
// shape rather than 404 — the UI always has a form to render.
import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb";
import {
  getApiKeyPolicyRaw,
  updateApiKeyPolicy,
  deleteApiKeyPolicy,
} from "@/lib/db/repos/apiKeyPolicyRepo.js";
import { emptyPolicy, normalizePolicy } from "@/shared/utils/apiKeyPolicy.js";

const MAX_LIST_ENTRIES = 500;
const MAX_ENTRY_LENGTH = 200;

/**
 * Validate an incoming policy body. Returns { error } on bad input so the
 * caller can answer 400 instead of persisting something malformed.
 */
function validatePolicyInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "policy object required" };
  }
  const dimensions = ["models", "providers", "combos"];
  for (const dim of dimensions) {
    const rule = input[dim];
    if (rule === undefined || rule === null) continue;
    if (typeof rule !== "object" || Array.isArray(rule)) {
      return { error: `${dim} must be an object` };
    }
    if (rule.mode !== undefined && rule.mode !== "allow" && rule.mode !== "deny") {
      return { error: `${dim}.mode must be "allow" or "deny"` };
    }
    if (rule.list !== undefined) {
      if (!Array.isArray(rule.list)) return { error: `${dim}.list must be an array` };
      if (rule.list.length > MAX_LIST_ENTRIES) {
        return { error: `${dim}.list exceeds the ${MAX_LIST_ENTRIES} entry limit` };
      }
      for (const entry of rule.list) {
        if (typeof entry !== "string") return { error: `${dim}.list entries must be strings` };
        if (entry.length > MAX_ENTRY_LENGTH) {
          return { error: `${dim}.list entries must be at most ${MAX_ENTRY_LENGTH} characters` };
        }
      }
    }
  }

  const quotas = input.quotas;
  if (quotas !== undefined && quotas !== null) {
    if (typeof quotas !== "object" || Array.isArray(quotas)) {
      return { error: "quotas must be an object" };
    }
    for (const field of ["rpm", "tokensPerDay", "concurrency"]) {
      const value = quotas[field];
      if (value === undefined || value === null || value === "") continue;
      if (!Number.isSafeInteger(value) || value <= 0) {
        return { error: `quotas.${field} must be a positive integer` };
      }
    }
  }

  return { ok: true };
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const raw = await getApiKeyPolicyRaw(id);
    const policy = raw ? normalizePolicy(raw) : null;
    return NextResponse.json({
      policy: policy ? { ...emptyPolicy(), ...raw } : emptyPolicy(),
      restricted: Boolean(policy),
    });
  } catch (error) {
    console.log("Error fetching key policy:", error);
    return NextResponse.json({ error: "Failed to fetch key policy" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Accept either { policy: {...} } or the policy object directly.
    const input = body?.policy && typeof body.policy === "object" ? body.policy : body;
    const validation = validatePolicyInput(input);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const normalized = normalizePolicy(input);
    if (!normalized) {
      // Nothing restrictive configured — treat as "remove the policy".
      await deleteApiKeyPolicy(id);
      return NextResponse.json({ success: true, policy: emptyPolicy(), restricted: false });
    }

    await updateApiKeyPolicy(id, input);
    return NextResponse.json({ success: true, policy: { ...emptyPolicy(), ...input }, restricted: true });
  } catch (error) {
    console.log("Error updating key policy:", error);
    return NextResponse.json({ error: "Failed to update key policy" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    await deleteApiKeyPolicy(id);
    return NextResponse.json({ success: true, policy: emptyPolicy(), restricted: false });
  } catch (error) {
    console.log("Error deleting key policy:", error);
    return NextResponse.json({ error: "Failed to delete key policy" }, { status: 500 });
  }
}
