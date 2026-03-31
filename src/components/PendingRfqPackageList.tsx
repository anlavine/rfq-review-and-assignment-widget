import React, { useEffect, useState, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { PendingRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./PendingRfqPackageList.module.css";
import { getDueDateUrgency } from "../utils/dueDateUrgency";

const PAGE_SIZE = 50;
const MAX_VISIBLE_TAGS = 2;
/** Concurrency limit for metadata resolution to avoid flooding the server */
const META_BATCH_SIZE = 10;
/** Only fetch packages received within this many months */
const RECEIVED_MONTHS = 4;
/** How many packages to fetch per OSDK page request */
const FETCH_PAGE_SIZE = 50;

export type TabKey = "all" | "outstanding" | "skipped" | "reviewed";

const TABS: { key: TabKey; label: string; status: string | null }[] = [
  { key: "all", label: "All", status: null },
  { key: "outstanding", label: "Outstanding", status: "Active" },
  { key: "skipped", label: "Skipped", status: "Skipped" },
  { key: "reviewed", label: "Reviewed", status: "Reviewed" },
];

export interface Filters {
  dueDateStart: string;
  dueDateEnd: string;
  customerSearch: string;
  hasParsedTools: boolean;
}

/** Resolved metadata for a package */
interface PackageMeta {
  customerName: string | null;
  toolCount: number;
}

export type MergeStep = "selectSource" | "selectTarget" | null;
export type SplitStep = "selectPackage" | null;

interface PendingRfqPackageListProps {
  onSelectPackage: (packageId: string, completionStatus?: string) => void;
  onDeselectPackage: () => void;
  selectedPackageId: string | null;
  onTabChange?: (tab: TabKey) => void;
  refreshToken?: number;
  filters: Filters;
  mergeStep: MergeStep;
  mergeSourceId: string | null;
  onMergeSelect: (packageId: string, packageName: string) => void;
  splitStep: SplitStep;
  onSplitSelect: (packageId: string, packageName: string) => void;
}

/** Resolve customer name and tool count for a single package */
async function resolvePackageMeta(pkId: string): Promise<PackageMeta> {
  const [customerName, toolCount] = await Promise.all([
    (async () => {
      try {
        const page = await client(PendingRfqPackage)
          .where({ packageId: { $eq: pkId } })
          .pivotTo("betaAdécustomer")
          .fetchPage({ $pageSize: 1 });
        return page.data[0]?.customerName ?? null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const page = await client(PendingRfqPackage)
          .where({ packageId: { $eq: pkId } })
          .pivotTo("pendingRfqPackageTools")
          .fetchPage({ $pageSize: 1 });
        return page.data.length;
      } catch {
        return 0;
      }
    })(),
  ]);
  return { customerName, toolCount };
}

/** Resolve metadata for a batch with concurrency control, calling onBatch after each chunk */
async function resolveMetaStreaming(
  pkgs: Osdk.Instance<PendingRfqPackage>[],
  onBatch: (batch: Record<string, PackageMeta>) => void,
  isCancelled: () => boolean,
): Promise<void> {
  for (let i = 0; i < pkgs.length; i += META_BATCH_SIZE) {
    if (isCancelled()) return;
    const batch = pkgs.slice(i, i + META_BATCH_SIZE);
    const metas = await Promise.all(
      batch.map(async (pkg) => {
        const pkId = String(pkg.$primaryKey);
        const meta = await resolvePackageMeta(pkId);
        return { pkId, meta };
      }),
    );
    const batchResult: Record<string, PackageMeta> = {};
    for (const { pkId, meta } of metas) {
      batchResult[pkId] = meta;
    }
    if (!isCancelled()) {
      onBatch(batchResult);
    }
  }
}

function PendingRfqPackageList({ onSelectPackage, onDeselectPackage, selectedPackageId, onTabChange, refreshToken, filters, mergeStep, mergeSourceId, onMergeSelect, splitStep, onSplitSelect }: PendingRfqPackageListProps): React.ReactElement {
  // All packages fetched from server (last 4 months) — grows incrementally
  const [allPackages, setAllPackages] = useState<Osdk.Instance<PendingRfqPackage>[]>([]);
  const [metaMap, setMetaMap] = useState<Record<string, PackageMeta>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const loadIdRef = useRef(0);

  const activeStatus = TABS.find((t) => t.key === activeTab)?.status ?? null;

  // ── Incremental load: fetch packages in pages of 50, render after first page ──
  useEffect(() => {
    const loadId = ++loadIdRef.current;
    let cancelled = false;

    (async () => {
      setInitialLoading(true);
      setBackgroundLoading(false);
      setError(null);
      setAllPackages([]);
      setMetaMap({});
      try {
        // Build date cutoff: 4 months ago
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - RECEIVED_MONTHS);
        const cutoffStr = cutoff.toISOString().split("T")[0];

        let token: string | undefined;
        let hasMore = true;
        let isFirstPage = true;

        while (hasMore && !cancelled) {
          const page = await client(PendingRfqPackage)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .where({ receivedDate: { $gte: cutoffStr } } as any)
            .fetchPage({
              $pageSize: FETCH_PAGE_SIZE,
              ...(token ? { $nextPageToken: token } : {}),
              $orderBy: { dueDate: "asc" },
            });

          if (cancelled || loadId !== loadIdRef.current) return;

          const newPackages = page.data;

          // Append new packages to state immediately so the UI can render them
          setAllPackages((prev) => [...prev, ...newPackages]);

          // After the first page arrives, stop showing the full-screen spinner
          if (isFirstPage) {
            isFirstPage = false;
            setInitialLoading(false);
            if (page.nextPageToken) {
              setBackgroundLoading(true);
            }
          }

          // Start resolving metadata for this batch in the background
          // (fire-and-forget — each resolved chunk merges into metaMap)
          resolveMetaStreaming(
            newPackages,
            (batch) => {
              if (loadId === loadIdRef.current) {
                setMetaMap((prev) => ({ ...prev, ...batch }));
              }
            },
            () => cancelled || loadId !== loadIdRef.current,
          );

          token = page.nextPageToken;
          hasMore = !!token;
        }
      } catch (e) {
        if (!cancelled && loadId === loadIdRef.current) {
          setError(e instanceof Error ? e.message : "Failed to load packages");
        }
      } finally {
        if (!cancelled && loadId === loadIdRef.current) {
          setInitialLoading(false);
          setBackgroundLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // ── Client-side filtering ──
  const filteredPackages = useMemo(() => {
    return allPackages.filter((pkg) => {
      const pkId = String(pkg.$primaryKey);
      const meta = metaMap[pkId];

      // Tab / status filter
      if (activeStatus && pkg.completionStatus !== activeStatus) return false;

      // Due date range
      if (filters.dueDateStart && pkg.dueDate) {
        const due = pkg.dueDate.split("T")[0];
        if (due < filters.dueDateStart) return false;
      }
      if (filters.dueDateEnd && pkg.dueDate) {
        const due = pkg.dueDate.split("T")[0];
        if (due > filters.dueDateEnd) return false;
      }

      // Customer search (only if metadata resolved)
      if (filters.customerSearch && meta) {
        if (meta.customerName === null) return false;
        if (!meta.customerName.toLowerCase().includes(filters.customerSearch.toLowerCase())) return false;
      }

      // Has parsed tools (only if metadata resolved)
      if (filters.hasParsedTools && meta) {
        if (meta.toolCount === 0) return false;
      }

      return true;
    });
  }, [allPackages, metaMap, activeStatus, filters]);

  // ── Client-side pagination ──
  const totalPages = Math.max(1, Math.ceil(filteredPackages.length / PAGE_SIZE));
  const pagePackages = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return filteredPackages.slice(start, start + PAGE_SIZE);
  }, [filteredPackages, currentPage]);

  // Reset to page 0 when filters change
  const filterKey = `${activeStatus}|${filters.dueDateStart}|${filters.dueDateEnd}|${filters.customerSearch}|${filters.hasParsedTools}`;
  useEffect(() => {
    setCurrentPage(0);
  }, [filterKey]);

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage((p) => p + 1);
    }
  };

  const handleFirstPage = () => {
    setCurrentPage(0);
  };

  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    onTabChange?.(tab);
    if (selectedPackageId) {
      const newStatus = TABS.find((t) => t.key === tab)?.status ?? null;
      if (newStatus !== null) {
        const selectedPkg = allPackages.find(
          (p) => String(p.$primaryKey) === selectedPackageId,
        );
        if (!selectedPkg || selectedPkg.completionStatus !== newStatus) {
          onDeselectPackage();
        }
      }
    }
  };

  const tabBar = (
    <div className={css.tabBar}>
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`${css.tab} ${activeTab === tab.key ? css.tabActive : ""}`}
          onClick={() => handleTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={css.container}>
      <h2 className={css.title}>Pending RFQ Packages</h2>
      {tabBar}

      {mergeStep && (
        <div className={css.mergeBanner}>
          {mergeStep === "selectSource"
            ? "Select the SOURCE package (will be deleted)"
            : "Select the TARGET package (will receive tools)"}
        </div>
      )}
      {splitStep && (
        <div className={css.mergeBanner}>
          Select a package to split
        </div>
      )}

      {backgroundLoading && (
        <div className={css.backgroundLoadingBar}>
          Loading more packages… ({allPackages.length} loaded so far)
        </div>
      )}

      <div className={css.cardGrid}>
        {initialLoading ? (
          <div className={css.emptyCard}>Fetching packages…</div>
        ) : error ? (
          <div className={`${css.emptyCard} ${css.emptyCardError}`}>Error: {error}</div>
        ) : pagePackages.length === 0 ? (
          <div className={css.emptyCard}>No packages found.</div>
        ) : (
          pagePackages.map((pkg) => {
            const pkId = String(pkg.$primaryKey);
            const isMergeSource = mergeStep === "selectTarget" && pkId === mergeSourceId;
            const inSpecialMode = !!mergeStep || !!splitStep;
            return (
              <PackageCard
                key={pkg.$primaryKey}
                pkg={pkg}
                meta={metaMap[pkId]}
                isSelected={inSpecialMode ? isMergeSource : pkId === selectedPackageId}
                showStatus={activeTab === "all"}
                disabled={isMergeSource}
                onClick={() => {
                  if (mergeStep) {
                    if (!isMergeSource) {
                      onMergeSelect(pkId, pkg.packageName || pkg.subject || "Unnamed Package");
                    }
                  } else if (splitStep) {
                    onSplitSelect(pkId, pkg.packageName || pkg.subject || "Unnamed Package");
                  } else {
                    onSelectPackage(pkId, pkg.completionStatus ?? undefined);
                  }
                }}
              />
            );
          })
        )}
      </div>

      {!initialLoading && !error && filteredPackages.length > 0 && (
        <div className={css.paginationBar}>
          <span>
            Page {currentPage + 1} of {totalPages} &middot; {filteredPackages.length} result{filteredPackages.length !== 1 ? "s" : ""}
            {backgroundLoading && " (still loading…)"}
          </span>
          <div>
            {currentPage > 0 && (
              <button
                className={css.paginationButton}
                onClick={handleFirstPage}
                style={{ marginRight: 8 }}
              >
                First Page
              </button>
            )}
            <button
              className={css.paginationButton}
              onClick={handleNextPage}
              disabled={currentPage >= totalPages - 1}
            >
              Next Page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    const parts = date.split("T")[0].split("-");
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case "Active":
      return css.statusActive;
    case "Skipped":
      return css.statusSkipped;
    case "Reviewed":
      return css.statusReviewed;
    default:
      return css.statusDefault;
  }
}

function getTagClass(tag: string): string {
  switch (tag) {
    case "Targets":
      return css.tagTargets;
    case "Waiting for Data":
      return css.tagWaitingForData;
    case "Repeat Request":
      return css.tagRepeatRequest;
    case "Duplicate":
      return css.tagDuplicate;
    case "Update Quote":
      return css.tagUpdateQuote;
    default:
      return "";
  }
}

function TagsPopover({
  tags,
  triggerRef,
}: {
  tags: string[];
  triggerRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.top - 4,
        left: rect.left + rect.width / 2,
      });
    }
  }, [triggerRef]);

  if (!pos) return null;

  return ReactDOM.createPortal(
    <div
      className={css.moreTagsPopover}
      style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }}
    >
      {tags.map((tag, i) => (
        <span key={i} className={css.popoverTag}>{tag}</span>
      ))}
    </div>,
    document.body,
  );
}

/** Builds a combined "OEM · Platform · Model Year" string, skipping missing parts */
function buildVehicleLine(
  oem: string | undefined,
  platform: string | undefined,
  modelYear: string | undefined,
): string {
  const parts = [oem, platform, modelYear].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

interface PackageCardProps {
  pkg: Osdk.Instance<PendingRfqPackage>;
  meta?: PackageMeta;
  isSelected: boolean;
  showStatus: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function PackageCard({ pkg, meta, isSelected, showStatus, disabled, onClick }: PackageCardProps): React.ReactElement {
  const customerName = meta?.customerName ?? null;
  const customerLoading = meta === undefined;

  const urgency = getDueDateUrgency(pkg.dueDate, pkg.completionStatus);

  const tags = pkg.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowTags = tags.slice(MAX_VISIBLE_TAGS);
  const [showPopover, setShowPopover] = useState(false);
  const moreRef = useRef<HTMLSpanElement | null>(null);

  return (
    <div className={`${css.card} ${isSelected ? css.cardSelected : ""} ${urgency === "overdue" ? css.cardOverdue : urgency === "dueSoon" ? css.cardDueSoon : ""} ${disabled ? css.cardDisabled : ""}`} onClick={disabled ? undefined : onClick} role="button" tabIndex={disabled ? -1 : 0} onKeyDown={(e) => { if (e.key === "Enter" && !disabled) onClick(); }}>
      <div className={css.cardHeader}>
        <div className={css.cardTitle}>{pkg.packageName || pkg.subject || "[Unnamed Package]"}</div>
        {tags.length > 0 && (
          <div className={css.tagsInline}>
            {visibleTags.map((tag, i) => (
              <span key={i} className={`${css.tag} ${getTagClass(tag)}`}>{tag}</span>
            ))}
            {overflowTags.length > 0 && (
              <div className={css.moreTagsWrapper}>
                <span
                  ref={moreRef}
                  className={css.moreTagsTrigger}
                  onMouseEnter={() => setShowPopover(true)}
                  onMouseLeave={() => setShowPopover(false)}
                >
                  +{overflowTags.length}
                </span>
                {showPopover && <TagsPopover tags={tags} triggerRef={moreRef} />}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={css.cardMeta}>
        {customerLoading ? "…" : customerName ?? "—"}
        <span className={css.cardMetaSep}>·</span>
        {buildVehicleLine(pkg.oem, pkg.platform, pkg.modelYear)}
        <span className={css.cardMetaSep}>·</span>
        Due: {formatDate(pkg.dueDate)}
        {pkg.automatedDueDate === "true" && (
          <span className={css.autoIcon} title="Auto-generated due date">🤖</span>
        )}
        {showStatus && pkg.completionStatus && (
          <>
            <span className={css.cardMetaSep}>·</span>
            <span className={`${css.statusBadge} ${getStatusClass(pkg.completionStatus)}`}>
              {pkg.completionStatus}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default PendingRfqPackageList;

