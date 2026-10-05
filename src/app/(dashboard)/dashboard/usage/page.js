"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import Button from "@/shared/components/Button";
import UsageStats from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";
import DeleteByTimeModal from "./components/DeleteByTimeModal";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statsKey, setStatsKey] = useState(0);

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              className="w-full sm:w-auto"
            />
            <Button
              variant="outline"
              size="sm"
              icon="delete"
              onClick={() => setDeleteOpen(true)}
              title="Delete usage records by time"
            >
              Delete
            </Button>
          </div>
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={statsKey} period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}

      <DeleteByTimeModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete usage records"
        targetLabel="usage records"
        fetchCount={async (filter) => {
          const params = new URLSearchParams();
          if (filter.all) params.set("all", "1");
          if (filter.before) params.set("before", filter.before);
          if (filter.startDate) params.set("startDate", filter.startDate);
          if (filter.endDate) params.set("endDate", filter.endDate);
          const res = await fetch(`/api/usage/history/count?${params}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to preview count");
          return data.count;
        }}
        onDelete={async (filter) => {
          const params = new URLSearchParams();
          if (filter.all) params.set("all", "1");
          if (filter.before) params.set("before", filter.before);
          if (filter.startDate) params.set("startDate", filter.startDate);
          if (filter.endDate) params.set("endDate", filter.endDate);
          const res = await fetch(`/api/usage/history?${params}`, { method: "DELETE" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Delete failed");
          return data;
        }}
        onDeleted={() => setStatsKey((k) => k + 1)}
      />
    </div>
  );
}
