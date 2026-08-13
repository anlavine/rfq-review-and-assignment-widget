import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PendingRfqPackage, RfqPackage } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import { useEligibleEstimators } from "./useEligibleEstimators";
import { categorizeWorkType } from "../utils/workType";

const FETCH_PAGE_SIZE = 200;
/** Concurrency limit when resolving tool counts per package */
const LINK_BATCH_SIZE = 20;

export interface EstimatorWorkloadRow {
  id: string;
  name: string;
  packageCount: number;
  toolCount: number;
}

interface WorkloadCount {
  packageCount: number;
  toolCount: number;
}

function addCount(counts: Map<string, WorkloadCount>, estimatorId: string, toolCount: number): void {
  const existing = counts.get(estimatorId) ?? { packageCount: 0, toolCount: 0 };
  existing.packageCount += 1;
  existing.toolCount += toolCount;
  counts.set(estimatorId, existing);
}

function applyDelta(counts: Map<string, WorkloadCount>, estimatorId: string, packageDelta: number, toolDelta: number): Map<string, WorkloadCount> {
  const next = new Map(counts);
  const existing = next.get(estimatorId) ?? { packageCount: 0, toolCount: 0 };
  next.set(estimatorId, {
    packageCount: Math.max(0, existing.packageCount + packageDelta),
    toolCount: Math.max(0, existing.toolCount + toolDelta),
  });
  return next;
}

/**
 * Computes, for every eligible estimator, how many active packages are
 * currently assigned to them and the total number of tools across those
 * packages. Two exclusions mirror the Assignment list itself, so counts
 * reflect only work that's actually visible/assignable there:
 *   - Rep/Eng Change packages are excluded entirely.
 *   - A `PendingRfqPackage` already linked to an RFQ Package is excluded —
 *     once linked, the RFQ Package is the "real" work item, so counting
 *     both would double-count the same work.
 *
 * Data is only fetched while `enabled` is true, and is refetched when
 * `refreshToken` changes while enabled. Previously-loaded rows are kept
 * around while disabled rather than cleared, so toggling `enabled` off and
 * back on doesn't require a refetch. Callers that want data ready before
 * the user asks for it (e.g. preloading behind a collapsed panel) can just
 * pass `enabled: true` unconditionally.
 */
export function useEstimatorWorkload(
  enabled: boolean,
  refreshToken?: number,
): {
  rows: EstimatorWorkloadRow[];
  loading: boolean;
  error: string | null;
  /**
   * Applies a workload change locally — e.g. right after an assignment is
   * confirmed — instead of refetching. Increments `newAssigneeId`'s counts
   * by `toolCount`/1 package, and if `previousAssigneeId` is set and
   * different, decrements it by the same amount (a reassignment).
   */
  applyAssignmentDelta: (newAssigneeId: string, toolCount: number, previousAssigneeId?: string | null) => void;
} {
  const { estimators } = useEligibleEstimators();
  const [counts, setCounts] = useState<Map<string, WorkloadCount>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRefreshTokenRef = useRef<number | undefined | "never">("never");

  useEffect(() => {
    if (!enabled) return;
    if (loadedRefreshTokenRef.current !== "never" && loadedRefreshTokenRef.current === refreshToken) return;

    let cancelled = false;
    loadedRefreshTokenRef.current = refreshToken;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [pendingPages, rfqPages] = await Promise.all([
          (async () => {
            const results: Osdk.Instance<PendingRfqPackage>[] = [];
            let token: string | undefined;
            do {
              const page = await client(PendingRfqPackage)
                .where({ completionStatus: { $eq: "Active" } })
                .fetchPage({ $pageSize: FETCH_PAGE_SIZE, ...(token ? { $nextPageToken: token } : {}) });
              for (const p of page.data) {
                const hasAssignee = !!p.assignedEstimator && p.assignedEstimator.trim() !== "";
                const hasRfqLink = !!p.rfqPackageId && p.rfqPackageId.trim() !== "";
                // Exclude Rep/Eng Change work — matches the Assignment list's
                // own filtering, so workload counts reflect what's actually
                // visible/assignable there.
                if (categorizeWorkType(p.workType) === "engChange") continue;
                if (hasAssignee && !hasRfqLink) results.push(p);
              }
              token = page.nextPageToken;
            } while (token && !cancelled);
            return results;
          })(),
          (async () => {
            const results: Osdk.Instance<RfqPackage>[] = [];
            let token: string | undefined;
            do {
              const page = await client(RfqPackage)
                .where({ status: { $eq: "Active" } })
                .fetchPage({ $pageSize: FETCH_PAGE_SIZE, ...(token ? { $nextPageToken: token } : {}) });
              for (const p of page.data) {
                if (categorizeWorkType(p.workType) === "engChange") continue;
                const hasAssignee = !!p.assignedTo && p.assignedTo.trim() !== "";
                if (hasAssignee) results.push(p);
              }
              token = page.nextPageToken;
            } while (token && !cancelled);
            return results;
          })(),
        ]);

        if (cancelled) return;

        const nextCounts = new Map<string, WorkloadCount>();

        for (let i = 0; i < pendingPages.length && !cancelled; i += LINK_BATCH_SIZE) {
          const batch = pendingPages.slice(i, i + LINK_BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (pkg) => {
              let toolCount = 0;
              try {
                const page = await pkg.$link.pendingRfqPackageTools.fetchPage({ $pageSize: 200 });
                toolCount = page.data.length;
              } catch { /* non-critical */ }
              return { estimatorId: pkg.assignedEstimator!.trim(), toolCount };
            }),
          );
          for (const r of batchResults) addCount(nextCounts, r.estimatorId, r.toolCount);
        }

        if (cancelled) return;

        for (let i = 0; i < rfqPages.length && !cancelled; i += LINK_BATCH_SIZE) {
          const batch = rfqPages.slice(i, i + LINK_BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (pkg) => {
              let toolCount = 0;
              try {
                const page = await pkg.$link.rfqTool.fetchPage({ $pageSize: 200 });
                toolCount = page.data.length;
              } catch { /* non-critical */ }
              return { estimatorId: pkg.assignedTo!.trim(), toolCount };
            }),
          );
          for (const r of batchResults) addCount(nextCounts, r.estimatorId, r.toolCount);
        }

        if (cancelled) return;
        setCounts(nextCounts);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load estimator workload");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, refreshToken]);

  const rows = useMemo<EstimatorWorkloadRow[]>(() => {
    const list = estimators.map((e) => {
      const c = counts.get(e.id) ?? { packageCount: 0, toolCount: 0 };
      return { id: e.id, name: e.name, packageCount: c.packageCount, toolCount: c.toolCount };
    });
    list.sort((a, b) =>
      b.packageCount - a.packageCount
      || b.toolCount - a.toolCount
      || a.name.localeCompare(b.name),
    );
    return list;
  }, [estimators, counts]);

  const applyAssignmentDelta = useCallback((newAssigneeId: string, toolCount: number, previousAssigneeId?: string | null) => {
    setCounts((prev) => {
      let next = applyDelta(prev, newAssigneeId, 1, toolCount);
      if (previousAssigneeId && previousAssigneeId !== newAssigneeId) {
        next = applyDelta(next, previousAssigneeId, -1, -toolCount);
      }
      return next;
    });
  }, []);

  return { rows, loading, error, applyAssignmentDelta };
}
