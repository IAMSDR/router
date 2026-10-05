"use client";

import { useState, useEffect, useCallback } from "react";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

const PRESETS = [
  { value: "24h", label: "Older than 24h", ms: 24 * 3600 * 1000 },
  { value: "7d", label: "Older than 7 days", ms: 7 * 86400 * 1000 },
  { value: "30d", label: "Older than 30 days", ms: 30 * 86400 * 1000 },
  { value: "60d", label: "Older than 60 days", ms: 60 * 86400 * 1000 },
  { value: "custom", label: "Custom range" },
  { value: "all", label: "Delete all" },
];

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Shared time-based delete dialog with live preview count + confirmation.
 * Time-only filters (presets + custom range), per product decision.
 *
 * @param {string} title - Modal title
 * @param {string} targetLabel - e.g. "usage records" / "request details"
 * @param {function(filter):Promise<number>} fetchCount - resolves affected row count
 * @param {function(filter):Promise<{deleted:number}>} onDelete - performs delete
 */
export default function DeleteByTimeModal({ isOpen, onClose, title, targetLabel, fetchCount, onDelete, onDeleted }) {
  const [preset, setPreset] = useState("30d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [count, setCount] = useState(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const buildFilter = useCallback(() => {
    if (preset === "all") return { all: true };
    if (preset === "custom") {
      const f = {};
      if (startDate) f.startDate = new Date(startDate).toISOString();
      if (endDate) f.endDate = new Date(endDate).toISOString();
      return f;
    }
    const p = PRESETS.find((x) => x.value === preset);
    if (!p) return {};
    return { before: new Date(Date.now() - p.ms).toISOString() };
  }, [preset, startDate, endDate]);

  const filterValid = preset === "all" ? confirmText.trim().toUpperCase() === "DELETE" : preset !== "custom" || startDate || endDate;

  const resetPreview = () => {
    setCount(null);
    setCountError("");
  };

  const handlePreset = (v) => { setPreset(v); resetPreview(); };
  const handleStartDate = (v) => { setStartDate(v); resetPreview(); };
  const handleEndDate = (v) => { setEndDate(v); resetPreview(); };
  const handleConfirmText = (v) => { setConfirmText(v); resetPreview(); };

  // Live preview count (debounced). State updates happen inside the async
  // callback, never synchronously in the effect body.
  useEffect(() => {
    if (!isOpen) return;
    if (!filterValid) return;
    if (preset === "all" && confirmText.trim().toUpperCase() !== "DELETE") return;
    const filter = buildFilter();
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setCountLoading(true);
      try {
        const n = await fetchCount(filter);
        if (!cancelled) setCount(n);
      } catch (e) {
        if (!cancelled) setCountError(e?.message || "Failed to preview count");
      } finally {
        if (!cancelled) setCountLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isOpen, preset, startDate, endDate, confirmText, filterValid, buildFilter, fetchCount]);

  const handleClose = () => {
    if (deleting) return;
    setPreset("30d");
    setStartDate("");
    setEndDate("");
    setConfirmText("");
    setCount(null);
    setCountError("");
    setError("");
    onClose();
  };

  const handleDelete = async () => {
    setError("");
    setDeleting(true);
    try {
      const res = await onDelete(buildFilter());
      onDeleted?.(res);
      handleClose();
    } catch (e) {
      setError(e?.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting} disabled={!filterValid || (preset !== "all" && count === 0)}>
            {preset === "all" ? "Delete all" : "Delete"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handlePreset(p.value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                preset === p.value
                  ? "border-red-500/50 bg-red-500/10 text-text-main"
                  : "border-black/10 dark:border-white/10 text-text-muted hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="delete-start-date" className="text-sm font-medium text-text-main">Start (from)</label>
              <input
                id="delete-start-date"
                type="datetime-local"
                value={startDate}
                max={toLocalInputValue(new Date())}
                onChange={(e) => handleStartDate(e.target.value)}
                className="h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface w-full text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="delete-end-date" className="text-sm font-medium text-text-main">End (to)</label>
              <input
                id="delete-end-date"
                type="datetime-local"
                value={endDate}
                max={toLocalInputValue(new Date())}
                onChange={(e) => handleEndDate(e.target.value)}
                className="h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface w-full text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        )}

        {preset === "all" && (
          <div className="flex flex-col gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-sm text-text-main">
              This will permanently delete <strong>all {targetLabel}</strong>. Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => handleConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface w-full text-sm font-mono text-text-main focus:outline-none focus:ring-2 focus:ring-red-500/30"
            />
          </div>
        )}

        <div className="rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] p-3 text-sm">
          {countLoading ? (
            <span className="text-text-muted">Counting matching records…</span>
          ) : countError ? (
            <span className="text-red-600">{countError}</span>
          ) : count !== null ? (
            count === 0 ? (
              <span className="text-text-muted">No matching {targetLabel} found for this range.</span>
            ) : (
              <span className="text-text-main">
                This will permanently delete <strong>{count.toLocaleString()} {targetLabel}</strong>.
              </span>
            )
          ) : (
            <span className="text-text-muted">
              {preset === "custom" && !startDate && !endDate
                ? "Pick a start and/or end date to preview."
                : `Preview will appear here.`}
            </span>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
