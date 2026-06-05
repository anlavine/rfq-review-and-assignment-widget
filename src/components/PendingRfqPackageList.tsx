import React, { useEffect, useState, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import ReactDOM from "react-dom";
import { PendingRfqPackage, PendingRfqAttachments } from "@rfq-review-hub-widget-application/sdk";
import { Branches } from "@osdk/foundry.datasets";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./PendingRfqPackageList.module.css";
import { getDueDateUrgency } from "../utils/dueDateUrgency";
import { isMergedPackage } from "../utils/mergedFields";
import { isInlineImage } from "../utils/attachments";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";

const PAGE_SIZE = 50;
const MAX_VISIBLE_TAGS = 2;
/** Concurrency limit for metadata resolution to avoid flooding the server */
const META_BATCH_SIZE = 10;
/** Only fetch packages received within this many months */
const RECEIVED_MONTHS = 4;
/** How many packages to fetch per OSDK page request */
const FETCH_PAGE_SIZE = 50;
/** Dataset RID backing PendingRfqPackage */
const PENDING_PACKAGE_DATASET_RID = "ri.foundry.main.dataset.d1ca8ee5-fe27-46fa-9ef0-fef7be64799d";

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
  subjectSearch: string;
  customerSearch: string;
  platformSearch: string;
  selectedTags: string[];
  hasParsedTools: boolean;
}

/** Package IDs to exclude from auto-selection (e.g. just-skipped packages) */
export type ExcludeFromAutoSelect = string[];

/** Resolved metadata for a package */
interface PackageMeta {
  customerName: string | null;
  toolCount: number;
  attachmentCount: number;
}

export type MergeStep = "selectSource" | "selectTarget" | null;
export type SplitStep = "selectPackage" | null;
export type BulkSkipMode = boolean;

/** Imperative handle exposed to parent for optimistic updates */
export interface PendingRfqPackageListHandle {
  /** Optimistically update a package's completionStatus in local state */
  updatePackageStatus: (packageId: string, newStatus: string) => void;
  /** Optimistically update a package's tags in local state */
  updatePackageTags: (packageId: string, newTags: string[]) => void;
  /** Remove packages from local state (used after merges/splits) */
  removePackages: (packageIds: string[]) => void;
}

/** Local overrides applied optimistically before server confirms */
interface PackageOverrides {
  completionStatus?: string;
  tags?: string[];
}

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
  /** Called once after the initial load completes with the first package in the filtered list (if any) */
  onFirstPackageReady?: (packageId: string, completionStatus?: string) => void;
  /** Package IDs to exclude when auto-selecting the first package */
  excludeFromAutoSelect?: ExcludeFromAutoSelect;
  /** Whether bulk skip mode is active */
  bulkSkipMode?: BulkSkipMode;
  /** IDs currently checked for bulk skip */
  bulkSkipSelected?: string[];
  /** Toggle a package in/out of bulk skip selection */
  onBulkSkipToggle?: (packageId: string) => void;
  /** Select all visible (filtered) packages for bulk skip */
  onBulkSkipSelectAll?: (ids: string[]) => void;
  /** Deselect all packages for bulk skip */
  onBulkSkipDeselectAll?: () => void;
}

/** Resolve customer name, tool count, and attachment count for a single package */
async function resolvePackageMeta(pkg: Osdk.Instance<PendingRfqPackage>): Promise<PackageMeta> {
  const pkId = String(pkg.$primaryKey);
  const [customerName, toolCount, attachmentCount] = await Promise.all([
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
          .fetchPage({ $pageSize: 200 });
        return page.data.length;
      } catch {
        return 0;
      }
    })(),
    (async () => {
      const emailId = pkg.emailId;
      const fileNames = (pkg.attachmentFileNames ?? []).filter((n) => !isInlineImage(n));
      if (!emailId || fileNames.length === 0) return 0;
      try {
        const page = await client(PendingRfqAttachments)
          .where({
            $and: [
              { fileName: { $in: fileNames } },
              { emailId: { $eq: emailId } },
            ],
          })
          .fetchPage({ $pageSize: 200 });
        // De-duplicate by fileName
        const seen = new Set<string>();
        for (const att of page.data) {
          if (att.fileName) seen.add(att.fileName);
        }
        return seen.size;
      } catch {
        return 0;
      }
    })(),
  ]);
  return { customerName, toolCount, attachmentCount };
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
        const meta = await resolvePackageMeta(pkg);
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

/** Due date bucket for Outstanding tab section dividers */
type DueDateBucket = "noDueDate" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "later";

const BUCKET_LABELS: Record<DueDateBucket, string> = {
  noDueDate: "No Due Date",
  today: "Due Today",
  tomorrow: "Due Tomorrow",
  thisWeek: "Due This Week",
  nextWeek: "Due Next Week",
  later: "Due Later",
};

/** Order in which buckets should appear */
const BUCKET_ORDER: DueDateBucket[] = ["noDueDate", "today", "tomorrow", "thisWeek", "nextWeek", "later"];

/**
 * Assigns a package to a due-date bucket based on the current local date.
 * - No due date → "noDueDate"
 * - Overdue or due today → "today"
 * - Due tomorrow → "tomorrow"
 * - Due on or before Sunday of the current week → "thisWeek"
 * - Due on or before Sunday of the following week → "nextWeek"
 * - Everything else → "later"
 */
function getDueDateBucket(dueDate: string | undefined): DueDateBucket {
  if (!dueDate) return "noDueDate";

  const parts = dueDate.split("T")[0].split("-");
  const due = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // End of current week (Sunday). getDay(): 0=Sun, 1=Mon, …, 6=Sat
  const dayOfWeek = today.getDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);

  // End of next week (the following Sunday)
  const endOfNextWeek = new Date(endOfWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  if (due.getTime() <= today.getTime()) return "today"; // overdue + today
  if (due.getTime() === tomorrow.getTime()) return "tomorrow";
  if (due.getTime() <= endOfWeek.getTime()) return "thisWeek";
  if (due.getTime() <= endOfNextWeek.getTime()) return "nextWeek";
  return "later";
}

/** Format an ISO timestamp as Eastern Time, e.g. "Apr 30, 2026 at 2:15 PM ET" */
function formatLastUpdated(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET";
  } catch {
    return iso;
  }
}

const PendingRfqPackageList = forwardRef<PendingRfqPackageListHandle, PendingRfqPackageListProps>(function PendingRfqPackageList({ onSelectPackage, onDeselectPackage, selectedPackageId, onTabChange, refreshToken, filters, mergeStep, mergeSourceId, onMergeSelect, splitStep, onSplitSelect, onFirstPackageReady, excludeFromAutoSelect, bulkSkipMode, bulkSkipSelected, onBulkSkipToggle, onBulkSkipSelectAll, onBulkSkipDeselectAll }, ref) {
  // All packages fetched from server (last 4 months) — grows incrementally
  const [allPackages, setAllPackages] = useState<Osdk.Instance<PendingRfqPackage>[]>([]);
  const [metaMap, setMetaMap] = useState<Record<string, PackageMeta>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("outstanding");
  const loadIdRef = useRef(0);
  const paginationRef = useRef<HTMLDivElement | null>(null);
  /** Tracks whether we've already fired the auto-select for this load cycle */
  const autoSelectedRef = useRef(false);

  /** Optimistic overrides — keyed by packageId */
  const [overridesMap, setOverridesMap] = useState<Record<string, PackageOverrides>>({});

  // ── Expose imperative handle for optimistic updates ──
  useImperativeHandle(ref, () => ({
    updatePackageStatus(packageId: string, newStatus: string) {
      setOverridesMap((prev) => ({
        ...prev,
        [packageId]: { ...prev[packageId], completionStatus: newStatus },
      }));
    },
    updatePackageTags(packageId: string, newTags: string[]) {
      setOverridesMap((prev) => ({
        ...prev,
        [packageId]: { ...prev[packageId], tags: newTags },
      }));
    },
    removePackages(packageIds: string[]) {
      const idSet = new Set(packageIds);
      setAllPackages((prev) => prev.filter((p) => !idSet.has(String(p.$primaryKey))));
      setMetaMap((prev) => {
        const next = { ...prev };
        for (const id of packageIds) delete next[id];
        return next;
      });
      setOverridesMap((prev) => {
        const next = { ...prev };
        for (const id of packageIds) delete next[id];
        return next;
      });
    },
  }));

  const activeStatus = TABS.find((t) => t.key === activeTab)?.status ?? null;

  // ── Helper: get effective value of a package property, respecting overrides ──
  const getEffectiveStatus = (pkg: Osdk.Instance<PendingRfqPackage>): string | undefined => {
    const pkId = String(pkg.$primaryKey);
    return overridesMap[pkId]?.completionStatus ?? pkg.completionStatus;
  };

  const getEffectiveTags = (pkg: Osdk.Instance<PendingRfqPackage>): string[] => {
    const pkId = String(pkg.$primaryKey);
    return overridesMap[pkId]?.tags ?? pkg.tags ?? [];
  };

  // ── Prioritized two-phase load: Outstanding first, then the rest ──
  useEffect(() => {
    const loadId = ++loadIdRef.current;
    let cancelled = false;

    (async () => {
      setInitialLoading(true);
      setBackgroundLoading(false);
      setError(null);
      setAllPackages([]);
      setMetaMap({});
      setOverridesMap({});
      autoSelectedRef.current = false;

      // Fetch last updated timestamp from the dataset's latest transaction
      Branches.transactions(client, PENDING_PACKAGE_DATASET_RID, "master", {
        pageSize: 1,
        preview: true,
      }).then((res) => {
        if (cancelled || loadId !== loadIdRef.current) return;
        const latest = res.data[0];
        if (latest?.closedTime) {
          setLastUpdated(latest.closedTime);
        }
      }).catch(() => { /* ignore — non-critical */ });

      try {
        // Build date cutoff: 4 months ago
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - RECEIVED_MONTHS);
        const cutoffStr = cutoff.toISOString().split("T")[0];

        const dateFilter = { $or: [{ receivedDate: { $gte: cutoffStr } }, { receivedDate: { $isNull: true } }] };

        // Helper: deduplicate when appending to allPackages state
        const appendDeduped = (newPackages: Osdk.Instance<PendingRfqPackage>[]) => {
          setAllPackages((prev) => {
            const existingPks = new Set(prev.map((p) => String(p.$primaryKey)));
            const unique = newPackages.filter((p) => !existingPks.has(String(p.$primaryKey)));
            return unique.length > 0 ? [...prev, ...unique] : prev;
          });
        };

        // ── Phase 1: Load Outstanding (Active) packages first ──
        // Since the user lands on the Outstanding tab, prioritize these.
        let token: string | undefined;
        let hasMore = true;
        const phase1Packages: Osdk.Instance<PendingRfqPackage>[] = [];

        while (hasMore && !cancelled) {
          const page = await client(PendingRfqPackage)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .where({ $and: [dateFilter, { completionStatus: { $eq: "Active" } }] } as any)
            .fetchPage({
              $pageSize: FETCH_PAGE_SIZE,
              ...(token ? { $nextPageToken: token } : {}),
              $orderBy: { dueDate: "asc" },
            });

          if (cancelled || loadId !== loadIdRef.current) return;

          const newPackages = page.data;
          phase1Packages.push(...newPackages);
          setAllPackages((prev) => [...prev, ...newPackages]);

          // Resolve metadata in the background
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

        if (cancelled || loadId !== loadIdRef.current) return;

        // Collect unique conversationIds from Outstanding packages for sibling lookup
        const conversationIds = new Set<string>();
        for (const pkg of phase1Packages) {
          if (pkg.conversationId) conversationIds.add(pkg.conversationId);
        }

        // ── Phase 2 & Phase 3 run in PARALLEL after Phase 1 ──
        // Phase 2: Load conversation siblings (part of initial load)
        // Phase 3: Load all remaining non-Active packages (background)
        setBackgroundLoading(true);

        const phase2Promise = (async () => {
          // Fetch non-Active packages that share a conversationId with Outstanding ones.
          // Batch conversationIds to avoid overly large query clauses.
          const CONV_BATCH_SIZE = 20;
          const convIdArray = Array.from(conversationIds);

          for (let i = 0; i < convIdArray.length && !cancelled; i += CONV_BATCH_SIZE) {
            const batch = convIdArray.slice(i, i + CONV_BATCH_SIZE);
            const convIdFilter = { $or: batch.map((id) => ({ conversationId: { $eq: id } })) };

            let sibToken: string | undefined;
            let sibHasMore = true;

            while (sibHasMore && !cancelled) {
              const sibPage = await client(PendingRfqPackage)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .where({ $and: [dateFilter, convIdFilter, { $or: [{ completionStatus: { $ne: "Active" } }, { completionStatus: { $isNull: true } }] }] } as any)
                .fetchPage({
                  $pageSize: FETCH_PAGE_SIZE,
                  ...(sibToken ? { $nextPageToken: sibToken } : {}),
                  $orderBy: { dueDate: "asc" },
                });

              if (cancelled || loadId !== loadIdRef.current) return;

              const sibPackages = sibPage.data;
              appendDeduped(sibPackages);

              resolveMetaStreaming(
                sibPackages,
                (metaBatch) => {
                  if (loadId === loadIdRef.current) {
                    setMetaMap((prev) => ({ ...prev, ...metaBatch }));
                  }
                },
                () => cancelled || loadId !== loadIdRef.current,
              );

              sibToken = sibPage.nextPageToken;
              sibHasMore = !!sibToken;
            }
          }
        })();

        const phase3Promise = (async () => {
          // Load all non-Active packages in background; deduplicates against Phase 2 siblings.
          let token3: string | undefined;
          let hasMore3 = true;

          while (hasMore3 && !cancelled) {
            const page3 = await client(PendingRfqPackage)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .where({ $and: [dateFilter, { $or: [{ completionStatus: { $ne: "Active" } }, { completionStatus: { $isNull: true } }] }] } as any)
              .fetchPage({
                $pageSize: FETCH_PAGE_SIZE,
                ...(token3 ? { $nextPageToken: token3 } : {}),
                $orderBy: { dueDate: "asc" },
              });

            if (cancelled || loadId !== loadIdRef.current) return;

            const newPackages3 = page3.data;
            appendDeduped(newPackages3);

            resolveMetaStreaming(
              newPackages3,
              (metaBatch) => {
                if (loadId === loadIdRef.current) {
                  setMetaMap((prev) => ({ ...prev, ...metaBatch }));
                }
              },
              () => cancelled || loadId !== loadIdRef.current,
            );

            token3 = page3.nextPageToken;
            hasMore3 = !!token3;
          }
        })();

        // Phase 2 completing marks the end of "initial" load (Outstanding + siblings ready)
        phase2Promise.then(() => {
          if (!cancelled && loadId === loadIdRef.current) {
            setInitialLoading(false);
          }
        });

        // Wait for both to finish before clearing backgroundLoading
        await Promise.all([phase2Promise, phase3Promise]);
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

  // ── Build conversation lookup for sibling-based filtering ──
  // Groups packages by conversationId for efficient sibling checks.
  const conversationMap = useMemo(() => {
    const map = new Map<string, Osdk.Instance<PendingRfqPackage>[]>();
    for (const pkg of allPackages) {
      const convId = pkg.conversationId;
      if (!convId) continue;
      const list = map.get(convId);
      if (list) {
        list.push(pkg);
      } else {
        map.set(convId, [pkg]);
      }
    }
    return map;
  }, [allPackages]);

  // ── Client-side filtering + sorting ──
  const filteredPackages = useMemo(() => {
    const filtered = allPackages.filter((pkg) => {
      const pkId = String(pkg.$primaryKey);
      const meta = metaMap[pkId];

      // Use effective (overridden) values for filtering
      const effectiveStatus = getEffectiveStatus(pkg);
      const effectiveTags = getEffectiveTags(pkg);

      // Tab / status filter
      if (activeStatus && effectiveStatus !== activeStatus) return false;

      // Due date range
      if (filters.dueDateStart && pkg.dueDate) {
        const due = pkg.dueDate.split("T")[0];
        if (due < filters.dueDateStart) return false;
      }
      if (filters.dueDateEnd && pkg.dueDate) {
        const due = pkg.dueDate.split("T")[0];
        if (due > filters.dueDateEnd) return false;
      }

      // Subject search
      if (filters.subjectSearch) {
        if (!pkg.subject) return false;
        if (!pkg.subject.toLowerCase().includes(filters.subjectSearch.toLowerCase())) return false;
      }

      // Customer search — matches linked customer name OR raw customerName property
      if (filters.customerSearch) {
        const search = filters.customerSearch.toLowerCase();
        const linkedMatch = meta?.customerName?.toLowerCase().includes(search) ?? false;
        const rawMatch = pkg.customerName?.toLowerCase().includes(search) ?? false;
        if (!linkedMatch && !rawMatch) return false;
      }

      // Platform search
      if (filters.platformSearch) {
        if (!pkg.platform) return false;
        if (!pkg.platform.toLowerCase().includes(filters.platformSearch.toLowerCase())) return false;
      }

      // Tags filter — package must have ALL selected tags (uses effective tags)
      if (filters.selectedTags.length > 0) {
        if (!filters.selectedTags.some((t) => effectiveTags.includes(t))) return false;
      }

      // Has parsed tools (only if metadata resolved)
      if (filters.hasParsedTools && meta) {
        if (meta.toolCount === 0) return false;
      }

      return true;
    });

    // Sort: Outstanding tab → ascending due date (server default order)
    //       All other tabs → descending received datetime
    if (activeTab !== "outstanding") {
      filtered.sort((a, b) => {
        const aDate = a.receivedDatetime ?? a.receivedDate ?? "";
        const bDate = b.receivedDatetime ?? b.receivedDate ?? "";
        // Descending: newer first
        if (bDate > aDate) return 1;
        if (bDate < aDate) return -1;
        return 0;
      });
    }

    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPackages, metaMap, activeStatus, activeTab, filters, overridesMap]);

  // ── Auto-select first package after all pages have loaded ──
  // We wait for initialLoading to be false so the
  // full dataset is available. Selecting earlier could pick a package that
  // gets filtered out once later pages arrive.
  useEffect(() => {
    if (autoSelectedRef.current || initialLoading || filteredPackages.length === 0) return;
    // Only auto-select if nothing is currently selected
    if (selectedPackageId) return;
    autoSelectedRef.current = true;
    const excludeSet = new Set(excludeFromAutoSelect ?? []);
    const candidate = filteredPackages.find((p) => !excludeSet.has(String(p.$primaryKey)));
    if (!candidate) return;
    const candidateId = String(candidate.$primaryKey);
    onFirstPackageReady?.(candidateId, candidate.completionStatus ?? undefined);
  }, [initialLoading, filteredPackages, selectedPackageId, onFirstPackageReady, excludeFromAutoSelect]);

  // ── Client-side pagination ──
  const totalPages = Math.max(1, Math.ceil(filteredPackages.length / PAGE_SIZE));
  const pagePackages = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return filteredPackages.slice(start, start + PAGE_SIZE);
  }, [filteredPackages, currentPage]);

  // Reset to page 0 when filters change
  const filterKey = `${activeStatus}|${filters.dueDateStart}|${filters.dueDateEnd}|${filters.subjectSearch}|${filters.customerSearch}|${filters.platformSearch}|${filters.selectedTags.join(",")}|${filters.hasParsedTools}`;
  useEffect(() => {
    setCurrentPage(0);
  }, [filterKey]);

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage((p) => p + 1);
    }
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      paginationRef.current?.scrollIntoView({ block: "end" });
    });
  };

  const handleFirstPage = () => {
    setCurrentPage(0);
    scrollToBottom();
  };

  const handlePrevPage = () => {
    setCurrentPage((p) => p - 1);
    scrollToBottom();
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
        const selectedEffectiveStatus = selectedPkg ? getEffectiveStatus(selectedPkg) : undefined;
        if (!selectedPkg || selectedEffectiveStatus !== newStatus) {
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
      <div className={css.titleRow}>
        <h2 className={css.title}>Pending RFQ Packages</h2>
        {lastUpdated && (
          <span className={css.lastUpdated}>Last updated: {formatLastUpdated(lastUpdated)}</span>
        )}
      </div>
      {tabBar}

      {bulkSkipMode && (
        <div className={css.bulkSkipBar}>
          <span className={css.bulkSkipCount}>
            {bulkSkipSelected?.length ?? 0} selected
          </span>
          <button
            className={css.bulkSkipSelectAll}
            onClick={() => {
              const allIds = filteredPackages.map((p) => String(p.$primaryKey));
              onBulkSkipSelectAll?.(allIds);
            }}
          >
            Select All ({filteredPackages.length})
          </button>
          <button
            className={css.bulkSkipDeselectAll}
            onClick={() => onBulkSkipDeselectAll?.()}
            disabled={!bulkSkipSelected?.length}
          >
            Deselect All
          </button>
        </div>
      )}

      <div className={css.cardGrid}>
        {initialLoading || (backgroundLoading && activeTab !== "outstanding") ? (
          <div className={css.emptyCard}>Fetching packages…</div>
        ) : error ? (
          <div className={`${css.emptyCard} ${css.emptyCardError}`}>Error: {error}</div>
        ) : pagePackages.length === 0 ? (
          <div className={css.emptyCard}>No packages found.</div>
        ) : (
          (() => {
            const elements: React.ReactElement[] = [];
            let lastBucket: DueDateBucket | null = null;

            // For the outstanding tab, sort by bucket order first, then due date within each bucket
            const sortedForDisplay = activeTab === "outstanding"
              ? [...pagePackages].sort((a, b) => {
                const bucketA = getDueDateBucket(a.dueDate);
                const bucketB = getDueDateBucket(b.dueDate);
                const orderA = BUCKET_ORDER.indexOf(bucketA);
                const orderB = BUCKET_ORDER.indexOf(bucketB);
                if (orderA !== orderB) return orderA - orderB;
                // Within same bucket, ascending due date
                const dateA = a.dueDate ?? "";
                const dateB = b.dueDate ?? "";
                if (dateA < dateB) return -1;
                if (dateA > dateB) return 1;
                return 0;
              })
              : pagePackages;

            for (const pkg of sortedForDisplay) {
              const pkId = String(pkg.$primaryKey);

              // Insert section divider on the Outstanding tab
              if (activeTab === "outstanding") {
                const bucket = getDueDateBucket(pkg.dueDate);
                if (bucket !== lastBucket) {
                  lastBucket = bucket;
                  elements.push(
                    <div key={`divider-${bucket}`} className={css.sectionDivider}>
                      <span className={css.sectionDividerLabel}>{BUCKET_LABELS[bucket]}</span>
                    </div>,
                  );
                }
              }

              const isMergeSource = mergeStep === "selectTarget" && pkId === mergeSourceId;
              const inSpecialMode = !!mergeStep || !!splitStep;
              const isBulkChecked = bulkSkipMode && bulkSkipSelected?.includes(pkId);
              elements.push(
                <PackageCard
                  key={pkg.$primaryKey}
                  pkg={pkg}
                  meta={metaMap[pkId]}
                  overrides={overridesMap[pkId]}
                  isSelected={inSpecialMode ? isMergeSource : bulkSkipMode ? !!isBulkChecked : pkId === selectedPackageId}
                  showStatus={activeTab === "all"}
                  disabled={isMergeSource}
                  hasSiblings={!!pkg.conversationId && (conversationMap.get(pkg.conversationId)?.length ?? 0) > 1}
                  showCheckbox={!!bulkSkipMode}
                  checked={!!isBulkChecked}
                  onClick={() => {
                    if (bulkSkipMode) {
                      onBulkSkipToggle?.(pkId);
                    } else if (mergeStep) {
                      if (!isMergeSource) {
                        onMergeSelect(pkId, pkg.packageName || pkg.subject || "Unnamed Package");
                      }
                    } else if (splitStep) {
                      onSplitSelect(pkId, pkg.packageName || pkg.subject || "Unnamed Package");
                    } else {
                      onSelectPackage(pkId, (overridesMap[pkId]?.completionStatus ?? pkg.completionStatus) ?? undefined);
                    }
                  }}
                />,
              );
            }
            return elements;
          })()
        )}
      </div>

      {!initialLoading && !(backgroundLoading && activeTab !== "outstanding") && !error && filteredPackages.length > 0 && (
        <div className={css.paginationBar} ref={paginationRef}>
          <span>
            Page {currentPage + 1} of {totalPages} &middot; {filteredPackages.length} result{filteredPackages.length !== 1 ? "s" : ""}
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
            {currentPage > 0 && (
              <button
                className={css.paginationButton}
                onClick={handlePrevPage}
                style={{ marginRight: 8 }}
              >
                Previous Page
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
});

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
    case "No Quote":
      return css.tagNoQuote;
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
  overrides?: PackageOverrides;
  isSelected: boolean;
  showStatus: boolean;
  disabled?: boolean;
  hasSiblings?: boolean;
  showCheckbox?: boolean;
  checked?: boolean;
  onClick: () => void;
}

function PackageCard({ pkg, meta, overrides, isSelected, showStatus, disabled, hasSiblings, showCheckbox, checked, onClick }: PackageCardProps): React.ReactElement {
  const customerName = meta?.customerName ?? null;
  const customerLoading = meta === undefined;
  const metaLoaded = meta !== undefined;

  const toolCount = meta?.toolCount ?? null;
  const attachmentCount = meta?.attachmentCount ?? null;

  // Use effective (overridden) values
  const effectiveStatus = overrides?.completionStatus ?? pkg.completionStatus;
  const urgency = getDueDateUrgency(pkg.dueDate, effectiveStatus);

  const tags = overrides?.tags ?? pkg.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowTags = tags.slice(MAX_VISIBLE_TAGS);
  const [showPopover, setShowPopover] = useState(false);
  const moreRef = useRef<HTMLSpanElement | null>(null);

  return (
    <div className={`${css.card} ${isSelected ? css.cardSelected : ""} ${disabled ? css.cardDisabled : ""}`} onClick={disabled ? undefined : onClick} role="button" tabIndex={disabled ? -1 : 0} onKeyDown={(e) => { if (e.key === "Enter" && !disabled) onClick(); }}>
      <div className={css.cardHeader}>
        {showCheckbox && (
          <input
            type="checkbox"
            className={css.bulkCheckbox}
            checked={!!checked}
            readOnly
            tabIndex={-1}
          />
        )}
        <div className={css.cardTitle}>{hasSiblings && <span className={css.conversationIcon} title="Part of a conversation with sibling packages">💬</span>}{pkg.subject || pkg.packageName || "[Unnamed Package]"}</div>
        {pkg.rfqPackageId && (
          <span className={css.rfqPackageIdChip} title={`RFQ Package ID: ${pkg.rfqPackageId}`}>
            <svg className={css.rfqPackageIdIcon} viewBox="0 0 16 16" fill="currentColor">
              <path d="M8.5 1.2l5 2.4a1 1 0 0 1 .5.9v7a1 1 0 0 1-.5.9l-5 2.4a1 1 0 0 1-.9 0l-5-2.4a1 1 0 0 1-.6-.9v-7a1 1 0 0 1 .5-.9l5-2.4a1 1 0 0 1 1 0ZM8 3.1L4.3 4.9 8 6.7l3.7-1.8L8 3.1ZM3 6.1v5l4.5 2.1V8.3L3 6.1Zm10 5V6.1l-4.5 2.2v4.8l4.5-2.1Z" />
            </svg>
            {pkg.rfqPackageId}
          </span>
        )}
        {isMergedPackage(pkg.from, pkg.to, pkg.subject, pkg.bodyContent) && (
          <span className={css.mergedIcon} title="Merged Package">⛙</span>
        )}
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
        <div className={css.countChips}>
          <span className={css.countChip} title="Parsed tools">
            <svg className={css.countChipIcon} viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.92 1.08a3.5 3.5 0 0 0-4.56 4.03L2.04 10.4a1.5 1.5 0 0 0 0 2.12l1.42 1.42a1.5 1.5 0 0 0 2.12 0l5.3-5.32a3.5 3.5 0 0 0 4.03-4.56l-2.1 2.1-1.42-.01-.7-.7-.01-1.42 2.1-2.1Z" />
            </svg>
            {metaLoaded ? toolCount : "…"}
          </span>
          <span className={css.countChip} title="Parsed attachments">
            <svg className={css.countChipIcon} viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.5 6.5l-5.14 5.14a2.5 2.5 0 0 1-3.54-3.54l5.84-5.84a1.5 1.5 0 0 1 2.12 2.12L6.04 10.1a.5.5 0 0 1-.7-.7L10.46 4.3l-.7-.72-5.14 5.12a1.5 1.5 0 0 0 2.12 2.12l5.72-5.72a2.5 2.5 0 0 0-3.54-3.54L3.08 7.4a3.5 3.5 0 0 0 4.96 4.96l5.14-5.14-.7-.7Z" />
            </svg>
            {attachmentCount !== null ? attachmentCount : "…"}
          </span>
        </div>
      </div>

      <div className={css.cardMeta}>
        <span className={css.cardMetaLeft}>
          {customerLoading ? "…" : customerName ?? "—"}
          <span className={css.cardMetaSep}>·</span>
          {buildVehicleLine(pkg.oem, pkg.platform, pkg.modelYear)}
          {showStatus && effectiveStatus && (
            <>
              <span className={css.cardMetaSep}>·</span>
              <span className={`${css.statusBadge} ${getStatusClass(effectiveStatus)}`}>
                {effectiveStatus}
              </span>
            </>
          )}
        </span>
        <span className={css.cardMetaRight}>
          <span>Received: {formatReceivedDatetime(pkg.receivedDatetime, pkg.receivedDate)}</span>
          <span className={css.cardMetaSep}>·</span>
          <span className={urgency === "overdue" ? css.dueDateOverdue : urgency === "dueSoon" ? css.dueDateDueSoon : css.dueDateNormal}>
            Due: {formatDate(pkg.dueDate)}
          </span>
          {(pkg.automatedDueDate === "true" || pkg.automatedDueDate === "True") && (
            <span className={css.autoIcon} title="Auto-generated due date">🤖</span>
          )}
        </span>
      </div>
    </div>
  );
}

export default PendingRfqPackageList;

