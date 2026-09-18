export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    // Load persistent capability overrides from DB into memory
    const { initModelCapabilities } = await import("@/lib/db");
    await initModelCapabilities().catch(() => {});

    // Fork addition: load per-API-key access policies into memory.
    const { initApiKeyPolicies } = await import("@/lib/db");
    await initApiKeyPolicies().catch(() => {});

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
