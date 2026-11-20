import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, toFiniteNumber } from "./shared.js";

const SUMMARY_FIELDS = [
  "requests", "tokens_total", "tokens_in", "tokens_out", "tokens_cached",
  "cache_hit_pct", "cost",
];

function readCount(value) {
  const count = toFiniteNumber(value, null);
  return count !== null && count >= 0 ? count : null;
}

function parseQuota(quota) {
  const unlimited = quota?.unlimited === true;
  const used = readCount(quota?.used);
  const total = readCount(quota?.quota);
  if (used === null || (!unlimited && total === null)) return null;

  const remaining = unlimited ? null : readCount(quota.remaining) ?? Math.max(0, total - used);
  return {
    used,
    total: unlimited ? 0 : total,
    remaining,
    remainingPercentage: unlimited ? 100 : total > 0 ? Math.min(100, (remaining / total) * 100) : 0,
    unlimited,
    unit: "tokens",
    resetAt: null,
  };
}

export async function getCfRouterUsage(apiKey, proxyOptions = null) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Cf Router API key not available. Add a key to view usage." };
  }

  try {
    const response = await proxyAwareFetch(U("cfrouter").url, {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": apiKey.trim() },
      cache: "no-store",
      // Fetch does not strip custom authentication headers on cross-origin redirects.
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Cf Router authentication failed. Check the API key." };
    }
    if (!response.ok) {
      return { message: `Cf Router usage API error (${response.status}).` };
    }

    const data = await response.json().catch(() => null);
    const summary = data?.summary;
    const quota = parseQuota(summary?.quota);
    const metrics = Object.fromEntries(SUMMARY_FIELDS
      .map((field) => [field, readCount(summary?.[field])])
      .filter(([, value]) => value !== null));

    if (!quota && Object.keys(metrics).length === 0) {
      return { message: "Cf Router returned no usage data." };
    }

    // Return only the metrics the dashboard uses, not key metadata or request history.
    return {
      plan: "Cf Router",
      quotas: quota ? { "Token quota": quota } : {},
      metrics,
    };
  } catch {
    return { message: "Could not reach the Cf Router usage API. Try refreshing." };
  }
}
