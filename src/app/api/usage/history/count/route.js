import { NextResponse } from "next/server";
import { countUsageHistory } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { canSeePayloads } from "@/app/api/usage/request-details/route.js";

/**
 * GET /api/usage/history/count?before=ISO&startDate=ISO&endDate=ISO&all=1
 * Preview how many usageHistory rows a time-filtered delete would remove.
 * Owner-only (same gate as delete).
 */
export async function GET(request) {
  try {
    let allowed = false;
    try {
      const settings = await getSettings();
      const token = request.cookies.get("auth_token")?.value;
      const authenticated = await verifyDashboardAuthToken(token);
      allowed = canSeePayloads({ requireLogin: settings?.requireLogin, authenticated });
    } catch {
      allowed = false;
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "Delete requires login to be enabled and an authenticated owner session" },
        { status: 403 }
      );
    }
    const { searchParams } = new URL(request.url);
    const all = searchParams.get("all") === "1" || searchParams.get("all") === "true";
    const filter = { all };
    const before = searchParams.get("before");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    if (before) filter.before = before;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    const count = await countUsageHistory(filter);
    return NextResponse.json({ count });
  } catch (error) {
    const msg = error?.message || "Failed to count usage history";
    const status = /invalid|provide a time bound/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
