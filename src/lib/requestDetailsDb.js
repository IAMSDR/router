// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
  flushRequestDetails, countRequestDetails, deleteRequestDetailById, deleteRequestDetails,
} from "@/lib/db/index.js";
