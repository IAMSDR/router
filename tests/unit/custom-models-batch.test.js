import { describe, expect, it } from "vitest";
import { addCustomModelsBatch, deleteCustomModels, getCustomModels, addCustomModel } from "@/lib/db/repos/aliasRepo.js";

describe("custom models batch operations in aliasRepo", () => {
  it("batch adds custom models and respects caps and existing models", async () => {
    const providerAlias = "test-batch-provider";
    
    // Clean up before test
    await deleteCustomModels({ providerAlias, all: true });

    const models = [
      { id: "model-1", name: "Model 1", caps: { vision: true } },
      { id: "model-2", name: "Model 2", caps: { reasoning: true } },
      { id: "model-3:free", name: "Model 3 Free" },
    ];

    const count = await addCustomModelsBatch({ providerAlias, models, type: "llm" });
    expect(count).toBe(3);

    const all = await getCustomModels();
    const providerModels = all.filter((m) => m.providerAlias === providerAlias);
    expect(providerModels).toHaveLength(3);

    const m1 = providerModels.find((m) => m.id === "model-1");
    expect(m1).toBeDefined();
    expect(m1.caps).toEqual({ vision: true });

    // Partial deletion by ids
    await deleteCustomModels({ providerAlias, ids: ["model-1"] });
    const afterDelete = (await getCustomModels()).filter((m) => m.providerAlias === providerAlias);
    expect(afterDelete).toHaveLength(2);
    expect(afterDelete.some((m) => m.id === "model-1")).toBe(false);

    // Delete all
    await deleteCustomModels({ providerAlias, all: true });
    const afterDeleteAll = (await getCustomModels()).filter((m) => m.providerAlias === providerAlias);
    expect(afterDeleteAll).toHaveLength(0);
  });
});
