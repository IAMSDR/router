"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

export default function ModelImportSplitButton({
  onImport,
  onSync,
  onImportFree,
  onSyncFree,
  disabled = false,
  loading = false,
  loadingText,
  label = "Import from /models",
  align = "right",
  className = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen]);

  const handleAction = (actionFn) => {
    setIsOpen(false);
    if (typeof actionFn === "function") {
      actionFn();
    }
  };

  return (
    <div className={`relative inline-flex items-stretch rounded-[8px] ${className}`} ref={containerRef}>
      {/* Primary Action Button */}
      <button
        type="button"
        onClick={onImport}
        disabled={disabled || loading}
        className="inline-flex items-center gap-1.5 rounded-l-[8px] border border-border border-r-0 bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-main transition-colors hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span
          className="material-symbols-outlined text-[16px]"
          style={loading ? { animation: "spin 1s linear infinite" } : undefined}
        >
          {loading ? "progress_activity" : "download"}
        </span>
        <span>{loading ? (loadingText || "Processing...") : label}</span>
      </button>

      {/* Dropdown Toggle Chevron */}
      <button
        type="button"
        onClick={() => !disabled && !loading && setIsOpen((prev) => !prev)}
        disabled={disabled || loading}
        aria-label="Open import options"
        aria-expanded={isOpen}
        className="inline-flex items-center justify-center rounded-r-[8px] border border-border bg-surface-2 px-1.5 py-1.5 text-text-main transition-colors hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={`material-symbols-outlined text-[16px] transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}>
          arrow_drop_down
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full mt-1.5 z-50 min-w-[240px] rounded-xl border border-border bg-sidebar p-1 shadow-xl backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-100`}
        >
          <button
            type="button"
            onClick={() => handleAction(onSync)}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-text-main hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px] text-text-muted mt-0.5">sync</span>
            <div className="flex flex-col">
              <span className="font-semibold text-text-main">Sync Models</span>
              <span className="text-[11px] text-text-muted leading-tight mt-0.5">
                Fetch /models, add new & remove outdated
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleAction(onImportFree)}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-text-main hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px] text-text-muted mt-0.5">savings</span>
            <div className="flex flex-col">
              <span className="font-semibold text-text-main">Import Free Only</span>
              <span className="text-[11px] text-text-muted leading-tight mt-0.5">
                Import only models ending in :free or -free
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleAction(onSyncFree)}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-text-main hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px] text-text-muted mt-0.5">sync_saved_locally</span>
            <div className="flex flex-col">
              <span className="font-semibold text-text-main">Sync Free Only</span>
              <span className="text-[11px] text-text-muted leading-tight mt-0.5">
                Keep only upstream free models
              </span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

ModelImportSplitButton.propTypes = {
  onImport: PropTypes.func.isRequired,
  onSync: PropTypes.func.isRequired,
  onImportFree: PropTypes.func.isRequired,
  onSyncFree: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  loadingText: PropTypes.string,
  label: PropTypes.string,
  align: PropTypes.oneOf(["left", "right"]),
  className: PropTypes.string,
};
