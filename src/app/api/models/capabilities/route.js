import { NextResponse } from "next/server";
import { getModelCapabilities, updateModelCapabilities, deleteModelCapabilities } from "@/lib/localDb";

export async function GET() {
  try {
    const overrides = await getModelCapabilities();
    return NextResponse.json({ overrides });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { model, capabilities } = await request.json();
    if (!model || typeof model !== "string" || !capabilities) {
      return NextResponse.json({ error: "model string and capabilities object required" }, { status: 400 });
    }
    const updated = await updateModelCapabilities(model.trim(), capabilities);
    return NextResponse.json({ success: true, overrides: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const queryModel = url.searchParams.get("model");
    let modelToDelete = queryModel;
    if (!modelToDelete) {
      try {
        const body = await request.json();
        modelToDelete = body?.model;
      } catch {}
    }
    if (!modelToDelete) {
      return NextResponse.json({ error: "model parameter required" }, { status: 400 });
    }
    const updated = await deleteModelCapabilities(modelToDelete.trim());
    return NextResponse.json({ success: true, overrides: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
