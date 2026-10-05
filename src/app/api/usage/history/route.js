import { NextResponse } from "next/server";
import { getUsageStats, countUsageHistory, deleteUsageHistory } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { canSeePayloads } from "@/app/api/usage/request-details/route.js";

async function isDeleteAllowed(request) {
  try {
    const settings = await getSettings();
    const token = request.cookies.get("auth_token")?.value;
    const authenticated = await verifyDashboardAuthToken(token);
    return canSeePayloads({ requireLogin: settings?.requireLogin, authenticated });
  } catch {
    return false;
  }
}

function parseTimeFilter(searchParams) {
  const all = searchParams.get("all") === "1" || searchParams.get("all") === "true";
  const before = searchParams.get("before");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const filter = { all };
  if (before) filter.before = before;
  if (startDate) filter.startDate = startDate;
  if (endDate) filter.endDate = endDate;
  return filter;
}

export async function GET() {
  try {
    const stats = await getUsageStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}

/**
 * DELETE /api/usage/history?before=ISO&startDate=ISO&endDate=ISO&all=1
 * Time-only bulk delete of usageHistory (+ rebuilds usageDaily aggregates).
 * Owner-only (same gate as request payload viewing).
 */
export async function DELETE(request) {
  try {
    if (!(await isDeleteAllowed(request))) {
      return NextResponse.json(
        { error: "Delete requires login to be enabled and an authenticated owner session" },
        { status: 403 }
      );
    }
    const { searchParams } = new URL(request.url);
    const filter = parseTimeFilter(searchParams);
    if (searchParams.get("dryRun") === "1" || searchParams.get("count") === "1") {
      const count = await countUsageHistory(filter);
      return NextResponse.json({ count });
    }
    const { deleted } = await deleteUsageHistory(filter);
    return NextResponse.json({ deleted });
  } catch (error) {
    const msg = error?.message || "Failed to delete usage history";
    const status = /invalid|provide a time bound/i.test(msg) ? 400 : 500;
    console.error("[API] Failed to delete usage history:", error);
    return NextResponse.json({ error: msg }, { status });
  }
}
