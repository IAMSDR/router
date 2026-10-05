// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  countUsageHistory, deleteUsageHistory,
  flushRequestDetails, countRequestDetails, deleteRequestDetailById, deleteRequestDetails,
} from "@/lib/db/index.js";
