import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

/**
 * Option B gate: full conversation payloads are only returned to an
 * authenticated dashboard owner (requireLogin enabled + valid auth_token
 * JWT). Otherwise payloads are redacted to prevent exposing every user's
 * prompts/responses when the dashboard is open (requireLogin=false) or the
 * caller is unauthenticated.
 */
export function canSeePayloads({ requireLogin, authenticated }) {
  return requireLogin !== false && authenticated === true;
}

async function isPayloadViewer(request) {
  try {
    const settings = await getSettings();
    const token = request.cookies.get("auth_token")?.value;
    const authenticated = await verifyDashboardAuthToken(token);
    return canSeePayloads({ requireLogin: settings?.requireLogin, authenticated });
  } catch {
    return false;
  }
}

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const pageRaw = parseInt(searchParams.get("page"));
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize"));
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    if (page < 1) {
      return NextResponse.json(
        { error: "Page must be >= 1" },
        { status: 400 }
      );
    }
    
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "PageSize must be between 1 and 100" },
        { status: 400 }
      );
    }
    
    const filter = {
      page,
      pageSize
    };
    
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    
    const result = await getRequestDetails(filter);

    // Option B: authenticated owners see full payloads; everyone else gets
    // metadata only. Stored details include full request bodies (user prompts,
    // tool calls) and provider responses — returning them wholesale when
    // requireLogin is disabled (or to an unauthenticated caller) would expose
    // every user's conversation history.
    if (await isPayloadViewer(request)) {
      return NextResponse.json(result);
    }

    const redactedDetails = (result.details || []).map((d) => {
      const redacted = { ...d };
      for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
        if (redacted[key] !== undefined) {
          redacted[key] = { redacted: true };
        }
      }
      return redacted;
    });

    return NextResponse.json({ ...result, details: redactedDetails });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
