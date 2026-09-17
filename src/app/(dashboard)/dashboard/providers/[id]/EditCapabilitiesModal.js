"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Toggle, Input } from "@/shared/components";

const MODALITIES_INPUT = [
  { key: "vision", label: "Vision", desc: "Accept image inputs" },
  { key: "pdf", label: "PDF / Documents", desc: "Accept document files" },
  { key: "audioInput", label: "Audio Input", desc: "Accept audio recordings" },
  { key: "videoInput", label: "Video Input", desc: "Accept video inputs" },
];

const MODALITIES_OUTPUT = [
  { key: "imageOutput", label: "Image Generation", desc: "Generate images" },
  { key: "audioOutput", label: "Audio Output", desc: "Generate speech / TTS" },
];

const FEATURES = [
  { key: "tools", label: "Tool Calling", desc: "Function / tool calling" },
  { key: "reasoning", label: "Reasoning / Thinking", desc: "Thinking blocks" },
];

export default function EditCapabilitiesModal({ isOpen, onClose, fullModel, currentCaps, onSaved }) {
  const [caps, setCaps] = useState({});
  const [contextWindow, setContextWindow] = useState("");
  const [maxOutput, setMaxOutput] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const c = currentCaps || {};
      setCaps({
        vision: !!c.vision,
        pdf: !!c.pdf,
        audioInput: !!c.audioInput,
        videoInput: !!c.videoInput,
        imageOutput: !!c.imageOutput,
        audioOutput: !!c.audioOutput,
        tools: c.tools !== false,
        reasoning: !!c.reasoning,
      });
      setContextWindow(c.contextWindow ? String(c.contextWindow) : "200000");
      setMaxOutput(c.maxOutput ? String(c.maxOutput) : "64000");
    }
  }, [isOpen, currentCaps]);

  const handleToggle = (key) => {
    setCaps((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!fullModel) return;
    setSaving(true);
    try {
      const payload = {
        ...caps,
        contextWindow: Number.parseInt(contextWindow, 10) || 200000,
        maxOutput: Number.parseInt(maxOutput, 10) || 64000,
      };
      const res = await fetch("/api/models/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, capabilities: payload }),
      });
      if (res.ok) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("customModelChanged"));
        }
        if (onSaved) onSaved(payload);
        onClose();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save capabilities");
      }
    } catch (err) {
      console.error("Save capabilities error:", err);
      alert("Failed to save capabilities");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!fullModel) return;
    if (!confirm(`Reset capabilities for ${fullModel} to built-in defaults?`)) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/models/capabilities?model=${encodeURIComponent(fullModel)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("customModelChanged"));
        }
        if (onSaved) onSaved(null);
        onClose();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to reset capabilities");
      }
    } catch (err) {
      console.error("Reset capabilities error:", err);
      alert("Failed to reset capabilities");
    } finally {
      setResetting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Configure Model Capabilities">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
            Target Model
          </label>
          <code className="block w-full px-3 py-2 text-xs font-mono bg-sidebar border border-border rounded-lg text-text-main">
            {fullModel}
          </code>
        </div>

        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
            Input Modalities
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODALITIES_INPUT.map((item) => (
              <div
                key={item.key}
                onClick={() => handleToggle(item.key)}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-sidebar/50 cursor-pointer transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] text-text-muted">{item.desc}</p>
                </div>
                <Toggle checked={!!caps[item.key]} onChange={() => handleToggle(item.key)} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
            Output Modalities
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODALITIES_OUTPUT.map((item) => (
              <div
                key={item.key}
                onClick={() => handleToggle(item.key)}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-sidebar/50 cursor-pointer transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] text-text-muted">{item.desc}</p>
                </div>
                <Toggle checked={!!caps[item.key]} onChange={() => handleToggle(item.key)} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
            Features
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FEATURES.map((item) => (
              <div
                key={item.key}
                onClick={() => handleToggle(item.key)}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-sidebar/50 cursor-pointer transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] text-text-muted">{item.desc}</p>
                </div>
                <Toggle checked={!!caps[item.key]} onChange={() => handleToggle(item.key)} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
            Token Limits
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Context Window (Input Tokens)"
              type="number"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              placeholder="200000"
            />
            <Input
              label="Max Output Tokens"
              type="number"
              value={maxOutput}
              onChange={(e) => setMaxOutput(e.target.value)}
              placeholder="64000"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border mt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleReset}
            disabled={saving || resetting}
            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            {resetting ? "Resetting..." : "Reset to Default"}
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={saving || resetting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || resetting}>
              {saving ? "Saving..." : "Save Override"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

EditCapabilitiesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  fullModel: PropTypes.string,
  currentCaps: PropTypes.object,
  onSaved: PropTypes.func,
};
