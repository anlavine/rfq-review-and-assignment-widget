import React, { useEffect, useState, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import ReactDOM from "react-dom";
import { PendingRfqPackage, PendingRfqAttachments, RfqPackage } from "@rfq-review-hub-widget-application/sdk";
import { Branches } from "@osdk/foundry.datasets";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./PendingRfqPackageList.module.css";
import { getDueDateUrgency } from "../utils/dueDateUrgency";
import { isMergedPackage } from "../utils/mergedFields";
import { isInlineImage } from "../utils/attachments";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import { getPriorityColorClass, comparePriorityTier, compareDueDateAsc } from "../utils/priorityColor";
import { fetchPriorityData } from "../hooks/usePriorityScores";
import { type Filters, ASSIGNED_TO_UNASSIGNED } from "./packageFilters";
import { type DueDateBucket, BUCKET_LABELS, BUCKET_ORDER, getDueDateBucket } from "../utils/dueDateBucket";

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
/** How often to poll for new data (ms) */
const POLL_INTERVAL_MS = 60_000;
/** Grace period after a new transaction is detected before showing the banner (ms).
 *  Gives the ontology time to index the new packages before a refresh is useful. */
const NEW_DATA_GRACE_PERIOD_MS = 120_000;

export type TabKey = "all" | "outstanding" | "skipped" | "reviewed";

// "status" is an array so a tab can match more than one completionStatus —
// the Skipped tab covers both "Skipped" (via Skip) and "Under Review" (via
// Skip and Review), since both are ways of taking a package out of
// Outstanding without fully reviewing it yet.
const TABS: { key: TabKey; label: string; status: string[] | null }[] = [
  { key: "all", label: "All", status: null },
  { key: "outstanding", label: "Outstanding", status: ["Active"] },
  { key: "skipped", label: "Skipped", status: ["Skipped", "Under Review"] },
  { key: "reviewed", label: "Reviewed", status: ["Reviewed"] },
];

/** Package IDs to exclude from auto-selection (e.g. just-skipped packages) */
export type ExcludeFromAutoSelect = string[];

/** Resolved metadata for a package */
interface PackageMeta {
  customerName: string | null;
  toolCount: number;
  attachmentCount: number;
  /**
   * The `assignedTo` value from the linked RFQ Package (an Employee primary
   * key). `null` means there is no linked RFQ Package or the linked package
   * has no assignee set. Used for the "Assigned To" filter.
   */
  rfqAssignedTo: string | null;
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
  /** Optimistically update a package's due date (and mark it as manually edited) in local state */
  updatePackageDueDate: (packageId: string, newDueDate: string | null) => void;
  /** Optimistically mark a package's due date as reviewed, without touching the due date value itself */
  markDueDateReviewed: (packageId: string) => void;
  /** Reverts an optimistic `markDueDateReviewed` call (e.g. the background action failed) */
  revertDueDateReviewed: (packageId: string) => void;
  /** Remove packages from local state (used after merges/splits) */
  removePackages: (packageIds: string[]) => void;
}

/** Local overrides applied optimistically before server confirms */
interface PackageOverrides {
  completionStatus?: string;
  tags?: string[];
  dueDate?: string | null;
  dueDateEdited?: boolean;
}

interface PendingRfqPackageListProps {
  onSelectPackage: (packageId: string, completionStatus?: string) => void;
  onDeselectPackage: () => void;
  selectedPackageId: string | null;
  onTabChange?: (tab: TabKey) => void;
  /**
   * Called whenever the Outstanding-tab sort mode changes (and once on
   * mount with the current default). Consumers use this to know whether
   * the user is viewing packages sorted by "priority" or "dueDate" —
   * which drives the `workspace` field on usage tracking
   * (`ingestion.priority` vs `ingestion.date`).
   */
  onOutstandingSortChange?: (sort: "dueDate" | "priority") => void;
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
  /** Called when a newer dataset transaction is detected; parent should increment refreshToken */
  onNewDataAvailable?: () => void;
}

/** Resolve customer name, tool count, and attachment count for a single package */
async function resolvePackageMeta(pkg: Osdk.Instance<PendingRfqPackage>): Promise<PackageMeta> {
  const pkId = String(pkg.$primaryKey);
  const [customerName, toolCount, attachmentCount, rfqAssignedTo] = await Promise.all([
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
    // Resolve linked RFQ Package assignee (Employee primary key). We use the
    // RFQ Package rather than the PendingRfqPackage's own assignedEstimator
    // because it may have been changed downstream during ingestion.
    (async () => {
      const rfqId = pkg.rfqPackageId;
      if (!rfqId) return null;
      try {
        const rfq = await client(RfqPackage).fetchOne(rfqId);
        const raw = rfq.assignedTo ?? null;
        if (raw === null) return null;
        const trimmed = String(raw).trim();
        return trimmed === "" ? null : trimmed;
      } catch {
        return null;
      }
    })(),
  ]);
  return { customerName, toolCount, attachmentCount, rfqAssignedTo };
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

const PendingRfqPackageList = forwardRef<PendingRfqPackageListHandle, PendingRfqPackageListProps>(function PendingRfqPackageList({ onSelectPackage, onDeselectPackage, selectedPackageId, onTabChange, onOutstandingSortChange, refreshToken, filters, mergeStep, mergeSourceId, onMergeSelect, splitStep, onSplitSelect, onFirstPackageReady, excludeFromAutoSelect, bulkSkipMode, bulkSkipSelected, onBulkSkipToggle, onBulkSkipSelectAll, onBulkSkipDeselectAll, onNewDataAvailable }, ref) {
  // All packages fetched from server (last 4 months) — grows incrementally
  const [allPackages, setAllPackages] = useState<Osdk.Instance<PendingRfqPackage>[]>([]);
  const [metaMap, setMetaMap] = useState<Record<string, PackageMeta>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  // Derived: most recent receivedDatetime (or receivedDate) across all loaded packages
  const lastUpdated = useMemo(() => {
    let best: string | null = null;
    for (const pkg of allPackages) {
      const t = pkg.receivedDatetime ?? pkg.receivedDate ?? null;
      if (t && (!best || t > best)) best = t;
    }
    return best;
  }, [allPackages]);

  const [newDataAvailable, setNewDataAvailable] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>("outstanding");
  /**
   * Sort mode for the Outstanding tab. Defaults to "priority" per product
   * request; session-only (no persistence). On other tabs this state exists
   * but has no effect on the rendered list.
   */
  const [outstandingSort, setOutstandingSort] = useState<"dueDate" | "priority">("dueDate");
  // Notify parent whenever the outstanding sort changes (and on mount, so
  // the initial "priority" default is broadcast).
  useEffect(() => {
    onOutstandingSortChange?.(outstandingSort);
  }, [outstandingSort, onOutstandingSortChange]);
  /**
   * Priority scores keyed by Pending package id. Populated in phases
   * alongside the package load so cards render with their correct
   * priority color and sort position on first paint — no post-load
   * reshuffle. See the phase-1/2/3 load below.
   */
  const [priorityMap, setPriorityMap] = useState<Map<string, number>>(new Map());
  const loadIdRef = useRef(0);
  const paginationRef = useRef<HTMLDivElement | null>(null);
  /** Tracks whether we've already fired the auto-select for this load cycle */
  const autoSelectedRef = useRef(false);

  /** Tracks the closedTime of the most recently seen transaction for polling */
  const lastTransactionTimeRef = useRef<string | null>(null);

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
    updatePackageDueDate(packageId: string, newDueDate: string | null) {
      setOverridesMap((prev) => ({
        ...prev,
        [packageId]: { ...prev[packageId], dueDate: newDueDate, dueDateEdited: true },
      }));
    },
    markDueDateReviewed(packageId: string) {
      setOverridesMap((prev) => ({
        ...prev,
        [packageId]: { ...prev[packageId], dueDateEdited: true },
      }));
    },
    revertDueDateReviewed(packageId: string) {
      setOverridesMap((prev) => {
        const existing = prev[packageId];
        if (!existing || !("dueDateEdited" in existing)) return prev;
        const next = { ...existing };
        delete next.dueDateEdited;
        return { ...prev, [packageId]: next };
      });
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

  // `dueDate` can be legitimately cleared to null, so an override must be
  // distinguished from "no override recorded" via key presence rather than
  // nullish-coalescing (which would otherwise fall through to the stale
  // server value whenever the override itself is null).
  const getEffectiveDueDate = (pkg: Osdk.Instance<PendingRfqPackage>): string | null => {
    const pkId = String(pkg.$primaryKey);
    const ov = overridesMap[pkId];
    if (ov && Object.prototype.hasOwnProperty.call(ov, "dueDate")) return ov.dueDate ?? null;
    return pkg.dueDate ?? null;
  };

  const getEffectiveDueDateEdited = (pkg: Osdk.Instance<PendingRfqPackage>): boolean | undefined => {
    const pkId = String(pkg.$primaryKey);
    return overridesMap[pkId]?.dueDateEdited ?? pkg.dueDateEdited;
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
      setPriorityMap(new Map());
      setOverridesMap({});
      setNewDataAvailable(false);
      autoSelectedRef.current = false;

      // Helper: merge additional priority entries into `priorityMap` state.
      const mergePriorityData = (data: {
        scores: Map<string, number>;
      }) => {
        if (data.scores.size === 0) return;
        setPriorityMap((prev) => {
          const next = new Map(prev);
          for (const [k, v] of data.scores) next.set(k, v);
          return next;
        });
      };










      // Fetch the latest transaction timestamp for polling purposes only.
      // Awaited so that lastTransactionTimeRef is guaranteed to be set before
      // backgroundLoading flips to false and the polling interval starts.
      try {
        const res = await Branches.transactions(client, PENDING_PACKAGE_DATASET_RID, "master", {
          pageSize: 1,
          preview: true,
        });
        if (!cancelled && loadId === loadIdRef.current) {
          const latest = res.data[0];
          if (latest?.closedTime) {
            lastTransactionTimeRef.current = latest.closedTime;
          }
        }

      } catch { /* ignore — non-critical */ }

      try {
        // Build date cutoff: 4 months ago, in both the date-only format
        // `receivedDate` uses and the full ISO timestamp `receivedDatetime`
        // uses — same instant either way.
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - RECEIVED_MONTHS);
        const cutoffDateStr = cutoff.toISOString().split("T")[0];
        const cutoffDatetimeStr = cutoff.toISOString();

        // `receivedDatetime` is treated as authoritative when present —
        // `receivedDate` is an older field that's occasionally wrong or
        // stale on individual records — falling back to `receivedDate` only
        // when `receivedDatetime` is missing. Mirrors the
        // `receivedDatetime ?? receivedDate` fallback used everywhere else
        // in this file for display/sorting, so a package that reads as
        // "recent" there can't silently fall outside this window.
        const dateFilter = {
          $or: [
            { receivedDatetime: { $gte: cutoffDatetimeStr } },
            {
              $and: [
                { receivedDatetime: { $isNull: true } },
                { $or: [{ receivedDate: { $gte: cutoffDateStr } }, { receivedDate: { $isNull: true } }] },
              ],
            },
          ],
        };

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
        // We paginate the packages themselves, then — before setting them
        // into state — fetch their priority scores so the Outstanding tab
        // renders already-sorted and already-colored (no post-load
        // reshuffle). Metadata resolution kicks off after each page but
        // does not block the priority fetch.
        let token: string | undefined;
        let hasMore = true;
        const phase1Packages: Osdk.Instance<PendingRfqPackage>[] = [];
        const phase1MetaPromises: Promise<void>[] = [];

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

          // Kick off metadata resolution but do not block on it.
          phase1MetaPromises.push(
            resolveMetaStreaming(
              newPackages,
              (batch) => {
                if (loadId === loadIdRef.current) {
                  setMetaMap((prev) => ({ ...prev, ...batch }));
                }
              },
              () => cancelled || loadId !== loadIdRef.current,
            ),
          );

          token = page.nextPageToken;
          hasMore = !!token;
        }

        if (cancelled || loadId !== loadIdRef.current) return;

        // Fetch priorities for the Outstanding packages, then commit both
        // packages and priorities in one shot so the very first paint
        // shows the correct sort order and color bands.
        const phase1Ids = phase1Packages
          .map((p) => String(p.$primaryKey))
          .filter(Boolean);
        const phase1Priority = await fetchPriorityData(phase1Ids);
        if (cancelled || loadId !== loadIdRef.current) return;
        mergePriorityData(phase1Priority);
        setAllPackages((prev) => [...prev, ...phase1Packages]);

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

              // Fetch priorities for the new siblings in parallel with meta.
              const sibIds = sibPackages
                .map((p) => String(p.$primaryKey))
                .filter(Boolean);
              fetchPriorityData(sibIds).then((data) => {
                if (loadId === loadIdRef.current && !cancelled) {
                  mergePriorityData(data);
                }
              });

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

            // Fetch priorities for these packages in parallel with meta.
            const phase3Ids = newPackages3
              .map((p) => String(p.$primaryKey))
              .filter(Boolean);
            fetchPriorityData(phase3Ids).then((data) => {
              if (loadId === loadIdRef.current && !cancelled) {
                mergePriorityData(data);
              }
            });

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

  // ── Poll for new data every POLL_INTERVAL_MS ──
  // Checks the latest dataset transaction. If newer than what we last saw,
  // waits NEW_DATA_GRACE_PERIOD_MS for the ontology to finish indexing,
  // then shows the banner. Does NOT auto-refresh — the user must click Refresh.
  useEffect(() => {
    if (initialLoading || backgroundLoading) return;

    const intervalId = setInterval(async () => {
      try {
        const res = await Branches.transactions(client, PENDING_PACKAGE_DATASET_RID, "master", {
          pageSize: 1,
          preview: true,
        });
        const latest = res.data[0];
        if (
          latest?.closedTime &&
          lastTransactionTimeRef.current !== null &&
          latest.closedTime > lastTransactionTimeRef.current
        ) {
          // Update the baseline so subsequent polls don't fire again for the same transaction
          lastTransactionTimeRef.current = latest.closedTime;
          // Wait for ontology indexing before surfacing the banner
          setTimeout(() => {
            setNewDataAvailable(true);
          }, NEW_DATA_GRACE_PERIOD_MS);
        }
      } catch {
        /* ignore — non-critical */
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [initialLoading, backgroundLoading]);

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
      const effectiveDueDate = getEffectiveDueDate(pkg);

      // Tab / status filter
      if (activeStatus && !activeStatus.includes(effectiveStatus ?? "")) return false;

      // Due date range
      if (filters.dueDateStart && effectiveDueDate) {
        const due = effectiveDueDate.split("T")[0];
        if (due < filters.dueDateStart) return false;
      }
      if (filters.dueDateEnd && effectiveDueDate) {
        const due = effectiveDueDate.split("T")[0];
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

      // Sender search — matches against the "from" field (name and/or email address)
      if (filters.senderSearch) {
        const search = filters.senderSearch.toLowerCase();
        if (!pkg.from?.toLowerCase().includes(search)) return false;
      }

      // Tags filter — package must have ALL selected tags (uses effective tags)
      if (filters.selectedTags.length > 0) {
        if (!filters.selectedTags.some((t) => effectiveTags.includes(t))) return false;
      }

      // Has parsed tools (only if metadata resolved)
      if (filters.hasParsedTools && meta) {
        if (meta.toolCount === 0) return false;
      }

      // Assigned-to filter — matches on the linked RFQ Package's assignedTo.
      // Skip when metadata is still resolving; once resolved, apply the filter.
      if (filters.assignedToIds.length > 0) {
        if (!meta) return false; // hide until metadata is loaded so we don't leak wrong matches
        const wantsUnassigned = filters.assignedToIds.includes(ASSIGNED_TO_UNASSIGNED);
        const otherIds = filters.assignedToIds.filter((v) => v !== ASSIGNED_TO_UNASSIGNED);
        const rfqAssignee = meta.rfqAssignedTo;
        const isUnassigned = rfqAssignee === null;
        const matchesUnassigned = wantsUnassigned && isUnassigned;
        const matchesSelected = !isUnassigned && otherIds.includes(rfqAssignee!);
        if (!matchesUnassigned && !matchesSelected) return false;
      }

      return true;
    });

    // Sort:
    //  - Outstanding tab, sort=priority → priority tier (High → Medium →
    //    Low), then due date asc, then received datetime asc (stable
    //    tiebreakers).
    //  - Outstanding tab, sort=dueDate  → leave in server order (asc due date),
    //    render step will further bucket by due-date group.
    //  - All other tabs → descending received datetime.
    if (activeTab === "outstanding") {
      if (outstandingSort === "priority") {
        filtered.sort((a, b) => {
          const aScore = priorityMap.get(String(a.$primaryKey)) ?? 0;
          const bScore = priorityMap.get(String(b.$primaryKey)) ?? 0;
          const tierCompare = comparePriorityTier(aScore, bScore);
          if (tierCompare !== 0) return tierCompare;
          const dueCompare = compareDueDateAsc(getEffectiveDueDate(a), getEffectiveDueDate(b));
          if (dueCompare !== 0) return dueCompare;
          const aRcv = a.receivedDatetime ?? a.receivedDate ?? "";
          const bRcv = b.receivedDatetime ?? b.receivedDate ?? "";
          if (aRcv === bRcv) return 0;
          if (!aRcv) return 1;
          if (!bRcv) return -1;
          return aRcv < bRcv ? -1 : 1;
        });
      }
    } else {
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
  }, [allPackages, metaMap, activeStatus, activeTab, filters, overridesMap, outstandingSort, priorityMap]);

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

  // Reset to page 0 when filters or the outstanding sort mode change
  const filterKey = `${activeStatus}|${filters.dueDateStart}|${filters.dueDateEnd}|${filters.subjectSearch}|${filters.customerSearch}|${filters.platformSearch}|${filters.senderSearch}|${filters.selectedTags.join(",")}|${filters.hasParsedTools}|${filters.assignedToIds.join(",")}|${outstandingSort}`;
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
        if (!selectedPkg || !newStatus.includes(selectedEffectiveStatus ?? "")) {
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

  // Small segmented control below the tab bar for choosing the Outstanding
  // sort mode. Only rendered on the Outstanding tab.
  const sortToggle = activeTab === "outstanding" ? (
    <div className={css.sortToggleRow}>
      <span className={css.sortToggleLabel}>Sort by:</span>
      <div className={css.sortToggle} role="tablist" aria-label="Sort outstanding packages by">
        <button
          type="button"
          role="tab"
          aria-selected={outstandingSort === "priority"}
          className={`${css.sortToggleOption} ${outstandingSort === "priority" ? css.sortToggleActive : ""}`}
          onClick={() => setOutstandingSort("priority")}
        >
          Priority
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={outstandingSort === "dueDate"}
          className={`${css.sortToggleOption} ${outstandingSort === "dueDate" ? css.sortToggleActive : ""}`}
          onClick={() => setOutstandingSort("dueDate")}
        >
          Due Date
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className={css.container}>
      <div className={css.titleRow}>
        <h2 className={css.title}>Pending RFQ Packages</h2>
        {lastUpdated && (
          <span className={css.lastUpdated}>Most recent: {formatReceivedDatetime(lastUpdated)}</span>
        )}
      </div>
      {newDataAvailable && (
        <div className={css.newDataBanner}>
          <span>New packages are available.</span>
          <button className={css.newDataRefreshBtn} onClick={() => onNewDataAvailable?.()}>
            Refresh
          </button>
          <button className={css.newDataDismissBtn} onClick={() => setNewDataAvailable(false)} title="Dismiss">
            ✕
          </button>
        </div>
      )}
      {tabBar}
      {sortToggle}

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

            // Bucketing + due-date grouping only applies on the Outstanding
            // tab when sorted by due date. When sorted by priority we render
            // a flat list already ordered by the parent `filteredPackages`
            // memo (priority desc, due date asc, received asc).
            const useBuckets = activeTab === "outstanding" && outstandingSort === "dueDate";

            const sortedForDisplay = useBuckets
              ? [...pagePackages].sort((a, b) => {
                const bucketA = getDueDateBucket(getEffectiveDueDate(a), getEffectiveDueDateEdited(a));
                const bucketB = getDueDateBucket(getEffectiveDueDate(b), getEffectiveDueDateEdited(b));
                const orderA = BUCKET_ORDER.indexOf(bucketA);
                const orderB = BUCKET_ORDER.indexOf(bucketB);
                if (orderA !== orderB) return orderA - orderB;
                // Within same bucket, ascending due date
                const dateA = getEffectiveDueDate(a) ?? "";
                const dateB = getEffectiveDueDate(b) ?? "";
                if (dateA < dateB) return -1;
                if (dateA > dateB) return 1;
                return 0;
              })
              : pagePackages;

            for (const pkg of sortedForDisplay) {
              const pkId = String(pkg.$primaryKey);

              // Insert section divider only when bucketing is on
              if (useBuckets) {
                const bucket = getDueDateBucket(getEffectiveDueDate(pkg), getEffectiveDueDateEdited(pkg));
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
              // Only apply priority color on the Outstanding tab
              const priorityScore = activeTab === "outstanding" ? priorityMap.get(pkId) ?? 0 : 0;
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
                  priorityScore={priorityScore}
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
    // "Under Review" is a Skip variant (via Skip and Review) — badge
    // resolves the same as plain "Skipped".
    case "Skipped":
    case "Under Review":
      return css.statusSkipped;
    case "Reviewed":
      return css.statusReviewed;
    default:
      return css.statusDefault;
  }
}

/** Display label for a status badge — "Under Review" resolves to "Skipped", matching its badge color. */
function getStatusLabel(status: string): string {
  return status === "Under Review" ? "Skipped" : status;
}

function getTagClass(tag: string): string {
  switch (tag) {
    case "Targets":
      return css.tagTargets;
    case "Waiting for Data":
      return css.tagWaitingForData;
    case "Repeat Request":
      return css.tagRepeatRequest;
    case "Duplicate Request":
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
  priorityScore?: number;
  onClick: () => void;
}

const CARD_PRIORITY_CLASSES = {
  high: css.cardBorderHigh,
  medium: css.cardBorderMedium,
  low: css.cardBorderLow
};

function PackageCard({ pkg, meta, overrides, isSelected, showStatus, disabled, hasSiblings, showCheckbox, checked, priorityScore, onClick }: PackageCardProps): React.ReactElement {
  const priorityBorderClass = getPriorityColorClass(priorityScore, CARD_PRIORITY_CLASSES);
  const customerName = meta?.customerName ?? null;
  const customerLoading = meta === undefined;
  const metaLoaded = meta !== undefined;

  const toolCount = meta?.toolCount ?? null;
  const attachmentCount = meta?.attachmentCount ?? null;

  // Use effective (overridden) values
  const effectiveStatus = overrides?.completionStatus ?? pkg.completionStatus;
  const effectiveDueDate = (overrides && Object.prototype.hasOwnProperty.call(overrides, "dueDate"))
    ? overrides.dueDate ?? null
    : pkg.dueDate ?? null;
  const urgency = getDueDateUrgency(effectiveDueDate ?? undefined, effectiveStatus);

  const tags = overrides?.tags ?? pkg.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowTags = tags.slice(MAX_VISIBLE_TAGS);
  const [showPopover, setShowPopover] = useState(false);
  const moreRef = useRef<HTMLSpanElement | null>(null);

  return (
    <div className={`${css.card} ${priorityBorderClass} ${isSelected ? css.cardSelected : ""} ${disabled ? css.cardDisabled : ""}`} onClick={disabled ? undefined : onClick} role="button" tabIndex={disabled ? -1 : 0} onKeyDown={(e) => { if (e.key === "Enter" && !disabled) onClick(); }}>
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
                {getStatusLabel(effectiveStatus)}
              </span>
            </>
          )}
        </span>
        <span className={css.cardMetaRight}>
          <span>Received: {formatReceivedDatetime(pkg.receivedDatetime, pkg.receivedDate)}</span>
          <span className={css.cardMetaSep}>·</span>
          <span className={urgency === "overdue" ? css.dueDateOverdue : urgency === "dueSoon" ? css.dueDateDueSoon : css.dueDateNormal}>
            Due: {formatDate(effectiveDueDate ?? undefined)}
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

