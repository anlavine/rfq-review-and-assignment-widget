import { useEffect, useState } from "react";
import { PendingRfqPriority } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";

const FETCH_PAGE_SIZE = 200;

/**
 * The seven factors that inform an overall priority score. Most are stored
 * as nullable integers (0/1) on `PendingRfqPriority`; `winRateCustomerOem`
 * and `customerPriority` are nullable doubles (0–1 scores).
 *
 * A factor is considered "present" (i.e. contributed to raising the score)
 * when its value is 1 for the integer factors, or ≥ 0.5 for the two double
 * factors. See `getPresentPriorityFactors` for the shared predicate.
 *
 * Each row on `PendingRfqPriority` exposes two variants of these factors
 * and score: a "pending" variant (used before a Pending package is linked
 * to an RFQ Package) and an "rfq" variant (used once linked). The active
 * variant is decided per-row by `hasRfqLink(row)`. See
 * `resolvePriorityForRow` for the shared reader.
 */
export interface PriorityFactors {
  capacityAtV1: number | null;
  customerPriority: number | null;
  winRateCustomerOem: number | null;
  isLiveProgram: number | null;
  hasProgramIncumbency: number | null;
  hasProgramCustomerIncumbency: number | null;
  isNetNewCustomer: number | null;
}

/** Human-readable labels for each priority factor. Keyed by factor id. */
export const PRIORITY_FACTOR_LABELS: Record<keyof PriorityFactors, string> = {
  customerPriority: "Customer is important.",
  hasProgramIncumbency: "Integrity's worked on this program before.",
  hasProgramCustomerIncumbency: "Integrity's worked on this program with this customer before.",
  isLiveProgram: "The program is live.",
  winRateCustomerOem: "OEM/Customer combination has a high historical win rate.",
  capacityAtV1: "There's production capacity at the V1 date.",
  isNetNewCustomer: "This is a net new customer.",
};
/**
 * Deterministic ordering of factors for UI rendering. Keeps the tooltip
 * consistent across packages.
 */
export const PRIORITY_FACTOR_ORDER: Array<keyof PriorityFactors> = [
  "customerPriority",
  "hasProgramIncumbency",
  "hasProgramCustomerIncumbency",
  "isLiveProgram",
  "winRateCustomerOem",
  "capacityAtV1",
  "isNetNewCustomer",
];
/**
 * Returns the ordered list of factor keys that are considered "present"
 * for a given `PriorityFactors` bundle.
 *
 *   - `winRateCustomerOem` and `customerPriority` are present when their
 *     value is ≥ 0.5 (both are 0–1 scores, not plain flags).
 *   - Every other factor is present when its value is exactly 1.
 *
 * Nullish or 0 values are treated as absent.
 */
export function getPresentPriorityFactors(
  factors: PriorityFactors | undefined | null,
): Array<keyof PriorityFactors> {
  if (!factors) return [];
  return PRIORITY_FACTOR_ORDER.filter((key) => {
    const value = factors[key];
    if (value == null) return false;
    if (key === "winRateCustomerOem" || key === "customerPriority") return value >= 0.5;
    return value === 1;
  });
}

/** Shape returned by the batched hook. */
export interface PriorityData {
  /** Map from packageId → active priority score (pending or rfq variant) */
  scores: Map<string, number>;
  /** Map from packageId → active priority factors (pending or rfq variant) */
  factors: Map<string, PriorityFactors>;
  /** Map from packageId → whether the "New Customer" star should show */
  isNetNewCustomer: Map<string, boolean>;
}

/**
 * Returns true when the `PendingRfqPriority` row is associated with a
 * downstream RFQ Package. The `rfq_*` variants of the factors/score should
 * be used in this case; otherwise the `pending_*` variants apply.
 */
function hasRfqLink(row: { rfqPackageId?: string | null | undefined }): boolean {
  const id = row.rfqPackageId;
  return typeof id === "string" && id.trim() !== "";
}

/**
 * Resolves the active priority score, factors, and net-new-customer flag
 * for a single `PendingRfqPriority` row, honoring the pending-vs-rfq
 * variant based on whether the row has an RFQ Package link.
 *
 * Strict semantics: when the row is linked to an RFQ Package, only the
 * `rfq_*` columns are consulted. A null `rfqPriorityScore` is surfaced as
 * `null` — we do not fall back to the pending variant.
 */
function resolvePriorityForRow(row: {
  rfqPackageId?: string | null | undefined;
  priorityScore?: number | null | undefined;
  rfqPriorityScore?: number | null | undefined;
  capacityAtV1?: number | null | undefined;
  rfqCapacityAtV1?: number | null | undefined;
  pendingCustomerPriority?: number | null | undefined;
  rfqCustomerPriority?: number | null | undefined;
  winRateCustomerOem?: number | null | undefined;
  rfqWinRateCustomerOem?: number | null | undefined;
  isLiveProgram?: number | null | undefined;
  rfqIsLiveProgram?: number | null | undefined;
  pendingHasProgramIncumbency?: number | null | undefined;
  rfqHasProgramIncumbency?: number | null | undefined;
  hasProgramCustomerIncumbency?: number | null | undefined;
  rfqHasProgramCustomerIncumbency?: number | null | undefined;
  isNetNewCustomer?: number | null | undefined;
  rfqIsNetNewCustomer?: number | null | undefined;
}): {
  score: number | null;
  factors: PriorityFactors;
  isNetNewCustomer: boolean;
} {
  const linked = hasRfqLink(row);
  if (linked) {
    return {
      score: row.rfqPriorityScore ?? null,
      factors: {
        capacityAtV1: row.rfqCapacityAtV1 ?? null,
        customerPriority: row.rfqCustomerPriority ?? null,
        winRateCustomerOem: row.rfqWinRateCustomerOem ?? null,
        isLiveProgram: row.rfqIsLiveProgram ?? null,
        hasProgramIncumbency: row.rfqHasProgramIncumbency ?? null,
        hasProgramCustomerIncumbency: row.rfqHasProgramCustomerIncumbency ?? null,
        isNetNewCustomer: row.rfqIsNetNewCustomer ?? null,
      },
      isNetNewCustomer: row.rfqIsNetNewCustomer === 1,
    };
  }
  return {
    score: row.priorityScore ?? null,
    factors: {
      capacityAtV1: row.capacityAtV1 ?? null,
      customerPriority: row.pendingCustomerPriority ?? null,
      winRateCustomerOem: row.winRateCustomerOem ?? null,
      isLiveProgram: row.isLiveProgram ?? null,
      hasProgramIncumbency: row.pendingHasProgramIncumbency ?? null,
      hasProgramCustomerIncumbency: row.hasProgramCustomerIncumbency ?? null,
      isNetNewCustomer: row.isNetNewCustomer ?? null,
    },
    isNetNewCustomer: row.isNetNewCustomer === 1,
  };
}

/**
 * Exported so `usePendingPackageDetail` (or any future consumer that reads
 * a single `PendingRfqPriority` row directly) can share the exact same
 * pending-vs-rfq semantics.
 */
export { resolvePriorityForRow, hasRfqLink };

/** Maximum number of packageIds per `$in` chunk when scoping the fetch. */
const IN_CHUNK_SIZE = 50;

/**
 * Fetches `PendingRfqPriority` rows for the given Pending package IDs and
 * returns the resolved score / factors / net-new-customer maps keyed by
 * `packageId1` (the plain Pending package id).
 *
 * The IDs are chunked (see `IN_CHUNK_SIZE`) and each chunk is fetched in
 * parallel — much faster than the historical "walk every priority row
 * that has ever existed" approach when we only need scores for the ~50–200
 * packages the list is actually rendering.
 *
 * Returns empty maps on error (priorities are non-critical UI data).
 */
export async function fetchPriorityData(
  packageIds: readonly string[],
): Promise<PriorityData> {
  const scores = new Map<string, number>();
  const factors = new Map<string, PriorityFactors>();
  const isNetNewCustomer = new Map<string, boolean>();

  if (packageIds.length === 0) {
    return { scores, factors, isNetNewCustomer };
  }

  // De-duplicate defensively — a package may appear in multiple phases.
  const uniqueIds = Array.from(new Set(packageIds));

  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += IN_CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(i, i + IN_CHUNK_SIZE));
  }

  try {
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        // Every priority row is expected to have exactly one match per
        // pending package id, so a single page of size == chunk.length is
        // sufficient. We pad slightly in case of duplicate rows.
        const page = await client(PendingRfqPriority)
          .where({ packageId1: { $in: chunk } })
          .fetchPage({ $pageSize: Math.max(chunk.length * 2, 50) });
        return page.data;
      }),
    );

    for (const chunk of chunkResults) {
      for (const p of chunk) {
        // `packageId1` is the plain Pending package id that matches
        // `PendingRfqPackage.$primaryKey`. `packageId` on this row is
        // the combined pending+rfq id used as the priority row's own
        // primary key and does not match back to `PendingRfqPackage`.
        const key = p.packageId1;
        if (!key) continue;
        const resolved = resolvePriorityForRow(p);
        if (resolved.score != null) {
          scores.set(key, resolved.score);
        }
        factors.set(key, resolved.factors);
        isNetNewCustomer.set(key, resolved.isNetNewCustomer);
      }
    }
  } catch {
    // Non-critical — leave data empty.
  }

  return { scores, factors, isNetNewCustomer };
}

/**
 * Fetches `PendingRfqPriority` records and exposes both the priorityScore
 * lookup and the six per-package priority factors used by the
 * priority-factors tooltip. Each row automatically picks the correct
 * variant: `rfq_*` columns when the row is linked to an RFQ Package,
 * otherwise the `pending_*` columns.
 *
 * When `packageIds` is provided, only priorities for those IDs are
 * fetched (chunked + parallel). This is the fast path used by the list
 * views once they know which packages they'll render.
 *
 * When `packageIds` is `undefined`, the hook falls back to paginating
 * every priority row — kept for any legacy consumers, though this path
 * can be slow on large datasets.
 *
 * All three maps are stable across re-renders unless `refreshToken` or
 * the identity of `packageIds` changes. Returns empty maps while loading
 * or on error (non-critical data).
 */
export function usePriorityData(
  refreshToken?: number,
  packageIds?: readonly string[],
): PriorityData {
  const [data, setData] = useState<PriorityData>({
    scores: new Map(),
    factors: new Map(),
    isNetNewCustomer: new Map(),
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Scoped mode: fetch only priorities for the given IDs.
        if (packageIds !== undefined) {
          const scoped = await fetchPriorityData(packageIds);
          if (!cancelled) setData(scoped);
          return;
        }

        // Fallback: walk every priority row (legacy behavior).
        const scores = new Map<string, number>();
        const factors = new Map<string, PriorityFactors>();
        const isNetNewCustomer = new Map<string, boolean>();
        let token: string | undefined;
        do {
          const page = await client(PendingRfqPriority).fetchPage({
            $pageSize: FETCH_PAGE_SIZE,
            ...(token ? { $nextPageToken: token } : {}),
          });
          for (const p of page.data) {
            const key = p.packageId1;
            if (!key) continue;
            const resolved = resolvePriorityForRow(p);
            if (resolved.score != null) {
              scores.set(key, resolved.score);
            }
            factors.set(key, resolved.factors);
            isNetNewCustomer.set(key, resolved.isNetNewCustomer);
          }
          token = page.nextPageToken;
        } while (token && !cancelled);

        if (cancelled) return;
        setData({ scores, factors, isNetNewCustomer });
      } catch {
        // Non-critical — leave data empty
      }
    })();

    return () => { cancelled = true; };
  }, [refreshToken, packageIds]);

  return data;
}

/**
 * Backwards-compatible convenience wrapper that returns only the score map.
 * New code that needs factor context should use `usePriorityData` directly.
 */
export function usePriorityScores(refreshToken?: number): Map<string, number> {
  return usePriorityData(refreshToken).scores;
}

