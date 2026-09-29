"use client";

import { useState } from "react";
import { Button, Input, Modal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

function generateRandomKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export default function CustomRelayModal({
  isOpen,
  onClose,
  onSuccess,
  onOpenDocs,
}) {
  const [formData, setFormData] = useState({
    name: "",
    proxyUrl: "",
    relayKey: "",
    isActive: true,
    strictProxy: false,
  });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const notify = useNotificationStore();

  const handleReset = () => {
    setFormData({
      name: "",
      proxyUrl: "",
      relayKey: "",
      isActive: true,
      strictProxy: false,
    });
    setTestResult(null);
    setTesting(false);
    setShowKey(false);
  };

  const handleClose = () => {
    if (saving || testing) return;
    handleReset();
    onClose();
  };

  const handleTest = async () => {
    const url = formData.proxyUrl.trim();
    const key = formData.relayKey.trim();

    if (!url) {
      notify.warning("Please enter a Relay URL to test");
      return;
    }
    if (!key) {
      notify.warning("Please enter the Relay Key to test");
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/proxy-pools/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxyUrl: url,
          relayKey: key,
          type: "custom",
        }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.ok) {
        notify.success(`Relay test passed (${data.elapsedMs}ms)`);
      } else {
        notify.error(data.error || "Relay test failed");
      }
    } catch (err) {
      const errRes = { ok: false, error: err.message || "Network test failed" };
      setTestResult(errRes);
      notify.error(errRes.error);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const name = formData.name.trim();
    const proxyUrl = formData.proxyUrl.trim();
    const relayKey = formData.relayKey.trim();

    if (!name) {
      notify.warning("Name is required");
      return;
    }
    if (!proxyUrl) {
      notify.warning("Relay URL is required");
      return;
    }
    if (!relayKey) {
      notify.warning("Relay Key is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/proxy-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          proxyUrl,
          relayKey,
          type: "custom",
          isActive: formData.isActive === true,
          strictProxy: formData.strictProxy === true,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        notify.success("Custom relay created successfully");
        handleReset();
        if (onSuccess) await onSuccess();
        onClose();
      } else {
        notify.error(data.error || "Failed to create relay");
      }
    } catch (err) {
      notify.error(err.message || "Failed to create relay");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      title="Add Custom / Self-Hosted Relay"
      onClose={handleClose}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {/* Info Banner */}
        <div className="rounded-lg bg-primary/5 border border-primary/15 p-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[18px]">dns</span>
              Self-Hosted or Multi-Platform Relay
            </span>
            {onOpenDocs && (
              <button
                type="button"
                onClick={onOpenDocs}
                className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
              >
                View Relay Specs & Code
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
            )}
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            Connect any server (Node.js, Python, VPS, Docker, or edge worker) running the 9Router Relay protocol.
            Requests are verified using <code className="font-mono text-primary bg-primary/10 px-1 py-0.5 rounded">x-relay-key</code>.
          </p>
        </div>

        {/* Inputs */}
        <Input
          label="Relay Name"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g. Frankfurt VPS Relay"
          required
        />

        <Input
          label="Relay Base URL"
          value={formData.proxyUrl}
          onChange={(e) => {
            setFormData((prev) => ({ ...prev, proxyUrl: e.target.value }));
            setTestResult(null);
          }}
          placeholder="https://relay.yourdomain.com"
          hint="The full public HTTP/HTTPS URL of your relay endpoint."
          required
        />

        {/* Relay Key input with generate & toggle button */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-main">
              Relay Key <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => {
                const key = generateRandomKey();
                setFormData((prev) => ({ ...prev, relayKey: key }));
                setTestResult(null);
              }}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]">auto_mode</span>
              Generate Key
            </button>
          </div>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={formData.relayKey}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, relayKey: e.target.value }));
                setTestResult(null);
              }}
              placeholder="Enter shared secret key"
              className="w-full py-2.5 px-3 pr-10 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-muted hover:text-text-main"
              tabIndex={-1}
            >
              <span className="material-symbols-outlined text-[18px]">
                {showKey ? "visibility_off" : "visibility"}
              </span>
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Sent in the <code className="font-mono text-primary">x-relay-key</code> header to authenticate requests.
          </p>
        </div>

        {/* Test Relay Button & Result Banner */}
        <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-main">Verify Connection</span>
            <Button
              size="sm"
              variant="secondary"
              icon={testing ? "progress_activity" : "science"}
              onClick={handleTest}
              disabled={testing || !formData.proxyUrl.trim() || !formData.relayKey.trim()}
            >
              {testing ? "Testing..." : "Test Relay"}
            </Button>
          </div>

          {testResult && (
            <div
              className={`rounded-md p-2.5 text-xs flex items-center gap-2 ${
                testResult.ok
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400"
              }`}
            >
              <span className="material-symbols-outlined text-[18px] shrink-0">
                {testResult.ok ? "check_circle" : "error"}
              </span>
              <div className="min-w-0 flex-1">
                {testResult.ok ? (
                  <p className="font-medium">
                    Relay test passed! Responded in {testResult.elapsedMs}ms
                  </p>
                ) : (
                  <p className="font-medium">
                    {testResult.error || `Test failed with status ${testResult.status}`}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-sm">Active</p>
            <p className="text-xs text-text-muted">Inactive pools are ignored by runtime resolution.</p>
          </div>
          <Toggle
            checked={formData.isActive === true}
            onChange={() => setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))}
            disabled={saving}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-sm">Strict Proxy</p>
            <p className="text-xs text-text-muted">Fail request if relay is unreachable instead of falling back to direct.</p>
          </div>
          <Toggle
            checked={formData.strictProxy === true}
            onChange={() => setFormData((prev) => ({ ...prev, strictProxy: !prev.strictProxy }))}
            disabled={saving}
          />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-2">
          <Button
            fullWidth
            onClick={handleSave}
            disabled={!formData.name.trim() || !formData.proxyUrl.trim() || !formData.relayKey.trim() || saving || testing}
          >
            {saving ? "Saving..." : "Add Relay"}
          </Button>
          <Button fullWidth variant="ghost" onClick={handleClose} disabled={saving || testing}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
