"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, CapacityBadges } from "@/shared/components";
import { ConfirmModal } from "@/shared/components/Modal";
import { getProviderCustomModelRows, isFreeModelId } from "@/shared/utils/providerCustomModels";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import EditCapabilitiesModal from "./EditCapabilitiesModal";
import ModelImportSplitButton from "../components/ModelImportSplitButton";

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, caps, onEditCaps }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{modelId}</p>
          {caps && <CapacityBadges caps={caps} colorOverride="text-text-muted/70" size={12} />}
        </div>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onEditCaps && (
            <div className="relative group/btn">
              <button
                onClick={onEditCaps}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors cursor-pointer"
                title="Configure capabilities"
              >
                <span className="material-symbols-outlined text-sm">tune</span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                Capabilities
              </span>
            </div>
          )}
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-500/10 rounded text-red-500 cursor-pointer"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({
  providerStorageAlias,
  providerDisplayAlias,
  modelAliases,
  customModels,
  copied,
  onCopy,
  onDeleteAlias,
  onAddCustomModel,
  onDeleteCustomModel,
  onAddCustomModelsBatch,
  onDeleteCustomModelsBatch,
  onDeleteAllCustomModels,
  onRefresh,
  connections,
  isAnthropic,
}) {
  const { getCaps } = useModelCaps();
  const [editingModel, setEditingModel] = useState(null);
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingText, setImportingText] = useState("");
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  // Helper to fetch live models from upstream /models
  const fetchUpstreamModels = async () => {
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) {
      throw new Error("Please add an active connection first.");
    }
    const res = await fetch(`/api/providers/${activeConnection.id}/models`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to fetch models from /models.");
    }
    const models = data.models || [];
    if (models.length === 0) {
      throw new Error("No models returned from /models.");
    }
    return models;
  };

  // Standard import: appends models not yet added
  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportingText("Importing...");
    try {
      const models = await fetchUpstreamModels();
      const existingIds = new Set(allModels.map((m) => m.id));
      const toAdd = [];

      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId || existingIds.has(modelId)) continue;
        existingIds.add(modelId);
        toAdd.push({ id: modelId, caps: model.capabilities || undefined });
      }

      if (toAdd.length === 0) {
        alert("All models already exist, no new models added.");
        return;
      }

      if (onAddCustomModelsBatch) {
        await onAddCustomModelsBatch(toAdd);
      } else {
        for (const item of toAdd) {
          await onAddCustomModel(item.id, item.caps);
        }
      }

      alert(`Successfully added ${toAdd.length} models.`);
    } catch (error) {
      console.log("Error importing models:", error);
      alert(error.message);
    } finally {
      setImporting(false);
      setImportingText("");
    }
  };

  // Sync: adds new models and removes outdated models from this provider
  const handleSync = async () => {
    if (importing) return;
    setImporting(true);
    setImportingText("Syncing...");
    try {
      const models = await fetchUpstreamModels();
      const upstreamMap = new Map();
      for (const m of models) {
        const id = m.id || m.name || m.model;
        if (id) upstreamMap.set(id, m);
      }

      const existingIds = new Set(allModels.map((m) => m.id));
      const toAdd = [];
      for (const [id, m] of upstreamMap.entries()) {
        if (!existingIds.has(id)) {
          toAdd.push({ id, caps: m.capabilities || undefined });
        }
      }

      // Models in customModels for this provider not in upstream
      const customRows = allModels.filter((m) => m.source === "custom");
      const toRemove = customRows.filter((m) => !upstreamMap.has(m.id)).map((m) => m.id);

      // Perform additions and deletions
      if (toRemove.length > 0) {
        if (onDeleteCustomModelsBatch) {
          await onDeleteCustomModelsBatch(toRemove);
        } else {
          for (const id of toRemove) {
            await onDeleteCustomModel(id);
          }
        }
      }

      if (toAdd.length > 0) {
        if (onAddCustomModelsBatch) {
          await onAddCustomModelsBatch(toAdd);
        } else {
          for (const item of toAdd) {
            await onAddCustomModel(item.id, item.caps);
          }
        }
      }

      if (toAdd.length === 0 && toRemove.length === 0) {
        alert("Models are already up to date.");
      } else {
        alert(`Sync complete: added ${toAdd.length} new model(s), removed ${toRemove.length} outdated model(s).`);
      }
    } catch (error) {
      console.log("Error syncing models:", error);
      alert(error.message);
    } finally {
      setImporting(false);
      setImportingText("");
    }
  };

  // Import Free Only: filters upstream for free pattern and adds new ones
  const handleImportFree = async () => {
    if (importing) return;
    setImporting(true);
    setImportingText("Importing free...");
    try {
      const models = await fetchUpstreamModels();
      const existingIds = new Set(allModels.map((m) => m.id));
      const freeModels = models.filter((m) => {
        const id = m.id || m.name || m.model;
        return isFreeModelId(id);
      });

      if (freeModels.length === 0) {
        alert("No free models (ending in :free, -free, etc.) found in /models.");
        return;
      }

      const toAdd = [];
      for (const model of freeModels) {
        const modelId = model.id || model.name || model.model;
        if (!modelId || existingIds.has(modelId)) continue;
        existingIds.add(modelId);
        toAdd.push({ id: modelId, caps: model.capabilities || undefined });
      }

      if (toAdd.length === 0) {
        alert("All free models already exist, no new models added.");
        return;
      }

      if (onAddCustomModelsBatch) {
        await onAddCustomModelsBatch(toAdd);
      } else {
        for (const item of toAdd) {
          await onAddCustomModel(item.id, item.caps);
        }
      }

      alert(`Successfully added ${toAdd.length} free models.`);
    } catch (error) {
      console.log("Error importing free models:", error);
      alert(error.message);
    } finally {
      setImporting(false);
      setImportingText("");
    }
  };

  // Sync Free Only: keeps only free models from upstream
  const handleSyncFree = async () => {
    if (importing) return;
    setImporting(true);
    setImportingText("Syncing free...");
    try {
      const models = await fetchUpstreamModels();
      const freeMap = new Map();
      for (const m of models) {
        const id = m.id || m.name || m.model;
        if (id && isFreeModelId(id)) {
          freeMap.set(id, m);
        }
      }

      if (freeMap.size === 0) {
        alert("No free models found in /models. Sync aborted to protect existing models.");
        return;
      }

      const existingIds = new Set(allModels.map((m) => m.id));
      const toAdd = [];
      for (const [id, m] of freeMap.entries()) {
        if (!existingIds.has(id)) {
          toAdd.push({ id, caps: m.capabilities || undefined });
        }
      }

      // Remove any custom model not in the upstream free list
      const customRows = allModels.filter((m) => m.source === "custom");
      const toRemove = customRows.filter((m) => !freeMap.has(m.id)).map((m) => m.id);

      if (toRemove.length > 0) {
        if (onDeleteCustomModelsBatch) {
          await onDeleteCustomModelsBatch(toRemove);
        } else {
          for (const id of toRemove) {
            await onDeleteCustomModel(id);
          }
        }
      }

      if (toAdd.length > 0) {
        if (onAddCustomModelsBatch) {
          await onAddCustomModelsBatch(toAdd);
        } else {
          for (const item of toAdd) {
            await onAddCustomModel(item.id, item.caps);
          }
        }
      }

      alert(`Sync complete: added ${toAdd.length} free model(s), removed ${toRemove.length} non-free/outdated model(s).`);
    } catch (error) {
      console.log("Error syncing free models:", error);
      alert(error.message);
    } finally {
      setImporting(false);
      setImportingText("");
    }
  };

  // Delete All handler
  const handleDeleteAllConfirm = async () => {
    setDeletingAll(true);
    try {
      // 1. Delete all custom models for this provider
      if (onDeleteAllCustomModels) {
        await onDeleteAllCustomModels();
      } else {
        const customRows = allModels.filter((m) => m.source === "custom");
        for (const m of customRows) {
          await onDeleteCustomModel(m.id);
        }
      }

      // 2. Delete any legacy aliases pointing to this provider
      const legacyAliases = allModels.filter((m) => m.source === "legacyAlias");
      for (const m of legacyAliases) {
        if (m.alias) {
          await onDeleteAlias(m.alias);
        }
      }

      if (onRefresh) {
        await onRefresh();
      }
      setDeleteConfirmOpen(false);
    } catch (error) {
      console.log("Error deleting all models:", error);
      alert("Failed to delete models: " + error.message);
    } finally {
      setDeletingAll(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <ModelImportSplitButton
          onImport={handleImport}
          onSync={handleSync}
          onImportFree={handleImportFree}
          onSyncFree={handleSyncFree}
          disabled={!canImport}
          loading={importing}
          loadingText={importingText}
          label="Import from /models"
        />
        <Button
          size="sm"
          variant="secondary"
          icon="delete_sweep"
          onClick={() => setDeleteConfirmOpen(true)}
          disabled={allModels.length === 0 || deletingAll || importing}
          className="text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/30"
        >
          {deletingAll ? "Deleting..." : "Delete All"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              isTesting={testingModelId === id}
              caps={getCaps(`${providerDisplayAlias}/${id}`)}
              onEditCaps={() => setEditingModel({ id, fullModel: `${providerDisplayAlias}/${id}`, caps: getCaps(`${providerDisplayAlias}/${id}`) })}
            />
          ))}
        </div>
      )}
      {editingModel && (
        <EditCapabilitiesModal
          isOpen={!!editingModel}
          onClose={() => setEditingModel(null)}
          fullModel={editingModel.fullModel}
          currentCaps={editingModel.caps}
        />
      )}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteAllConfirm}
        title="Delete All Models"
        message={`Are you sure you want to delete all ${allModels.length} model(s) for this provider? This action cannot be undone.`}
        confirmText="Delete All"
        variant="danger"
        loading={deletingAll}
      />
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  onAddCustomModelsBatch: PropTypes.func,
  onDeleteCustomModelsBatch: PropTypes.func,
  onDeleteAllCustomModels: PropTypes.func,
  onRefresh: PropTypes.func,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
