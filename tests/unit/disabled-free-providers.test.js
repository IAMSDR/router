import { describe, it, expect, vi, beforeEach } from "vitest";
import { getConnectionStatus } from "@/app/(dashboard)/dashboard/providers/utils.js";
import { getDeactivatedProviderIds } from "@/shared/utils/connectionStatus.js";

describe("Disabled Free Providers", () => {
  describe("getConnectionStatus", () => {
    it("returns 'active' for noAuth provider when not disabled", () => {
      const stats = { total: 1, allDisabled: false };
      expect(getConnectionStatus(stats, true)).toBe("active");
    });

    it("returns 'inactive' for noAuth provider when allDisabled is true", () => {
      const stats = { total: 1, allDisabled: true };
      expect(getConnectionStatus(stats, true)).toBe("inactive");
    });

    it("returns 'inactive' for noAuth provider with total=0 and allDisabled=true", () => {
      const stats = { total: 0, allDisabled: true };
      expect(getConnectionStatus(stats, true)).toBe("inactive");
    });
  });

  describe("getDeactivatedProviderIds", () => {
    it("includes disabled free provider when virtual connection has isActive === false", () => {
      const connections = [
        { id: "noauth-opencode", provider: "opencode", isActive: false, isNoAuth: true },
        { id: "conn-1", provider: "openai", isActive: true },
      ];
      const deactivated = getDeactivatedProviderIds(connections);
      expect(deactivated.has("opencode")).toBe(true);
      expect(deactivated.has("openai")).toBe(false);
    });

    it("does not include free provider when virtual connection has isActive === true", () => {
      const connections = [
        { id: "noauth-opencode", provider: "opencode", isActive: true, isNoAuth: true },
      ];
      const deactivated = getDeactivatedProviderIds(connections);
      expect(deactivated.has("opencode")).toBe(false);
    });

    it("includes providers explicitly in disabledProviders array", () => {
      const connections = [
        { id: "conn-1", provider: "openai", isActive: true },
      ];
      const deactivated = getDeactivatedProviderIds(connections, ["opencode", "mimo-free"]);
      expect(deactivated.has("opencode")).toBe(true);
      expect(deactivated.has("mimo-free")).toBe(true);
      expect(deactivated.has("openai")).toBe(false);
    });
  });

  describe("auth & models integration", () => {
    it("rejects credentials when provider is in disabledProviders", async () => {
      const { getSettings, updateSettings } = await import("@/lib/localDb.js");
      const { getProviderCredentials } = await import("@/sse/services/auth.js");

      await updateSettings({ disabledProviders: ["opencode"] });
      const creds = await getProviderCredentials("opencode");
      expect(creds).toBeNull();

      await updateSettings({ disabledProviders: [] });
      const activeCreds = await getProviderCredentials("opencode");
      expect(activeCreds).not.toBeNull();
      expect(activeCreds.id).toBe("noauth");
      expect(activeCreds.isActive).toBe(true);
    });

    it("excludes models from /v1/models when provider is in disabledProviders", async () => {
      const { updateSettings } = await import("@/lib/localDb.js");
      const { buildModelsList } = await import("@/app/api/v1/models/route.js");

      await updateSettings({ disabledProviders: ["opencode"] });
      const modelsDisabled = await buildModelsList(["llm"]);
      const ocModelsDisabled = modelsDisabled.filter(
        (m) => m.id.startsWith("oc/") || m.id.startsWith("opencode/")
      );
      expect(ocModelsDisabled.length).toBe(0);

      await updateSettings({ disabledProviders: [] });
      const modelsActive = await buildModelsList(["llm"]);
      const ocModelsActive = modelsActive.filter(
        (m) => m.id.startsWith("oc/") || m.id.startsWith("opencode/")
      );
      expect(ocModelsActive.length).toBeGreaterThan(0);
    });
  });
});
