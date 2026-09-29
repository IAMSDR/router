import { NextResponse } from "next/server";
import { testProxyUrl, testRelayUrl } from "@/lib/network/proxyTest";

// POST /api/proxy-pools/test - Test a proxy or relay URL before saving
export async function POST(request) {
  try {
    const body = await request.json();
    const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
    const relayKey = typeof body?.relayKey === "string" ? body.relayKey.trim() : "";
    const type = typeof body?.type === "string" ? body.type.trim() : "http";

    if (!proxyUrl) {
      return NextResponse.json({ ok: false, error: "Proxy / Relay URL is required" }, { status: 400 });
    }

    const isRelay = type === "custom" || type === "vercel" || type === "cloudflare" || type === "deno";

    const result = isRelay
      ? await testRelayUrl({ relayUrl: proxyUrl, relayKey })
      : await testProxyUrl({ proxyUrl });

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      statusText: result.statusText || null,
      error: result.error || null,
      elapsedMs: result.elapsedMs || 0,
    });
  } catch (error) {
    console.log("Error testing proxy/relay URL:", error);
    return NextResponse.json({ ok: false, error: error.message || "Failed to test proxy" }, { status: 500 });
  }
}
