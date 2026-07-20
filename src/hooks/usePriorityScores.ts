import { useEffect, useState } from "react";
import { PendingRfqPriority } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";

const FETCH_PAGE_SIZE = 200;

/**
 * The six factors that inform an overall priority score. All are stored as
 * nullable integers (0/1) on `PendingRfqPriority`, except `winRateCustomerOem`
 * which is a nullable double.
 *
 * A factor is considered "present" (i.e. contributed to raising the score)
 * when its value is 1 for the integer factors, or ≥ 0.5 for the win-rate
 * factor. See `getPresentPriorityFactors` for the shared predicate.
 */
export interface PriorityFactors {
  capacityAtV1: number | null;
  unmetTarget: number | null;
  winRateCustomerOem: number | null;
  isLiveProgram: number | null;
  hasProgramIncumbency: number | null;
  hasProgramCustomerIncumbency: number | null;
}

/** Human-readable labels for each priority factor. Keyed by factor id. */
export const PRIORITY_FACTOR_LABELS: Record<keyof PriorityFactors, string> = {
  capacityAtV1: "Capacity at V1",
  unmetTarget: "Unmet Target",
  winRateCustomerOem: "Win Rate Customer OEM",
  isLiveProgram: "Is Live Program",
  hasProgramIncumbency: "Has Program Incumbency",
  hasProgramCustomerIncumbency: "Has Program Customer Incumbency",
};

/**
 * Deterministic ordering of factors for UI rendering. Keeps the tooltip
 * consistent across packages.
 */
export const PRIORITY_FACTOR_ORDER: Array<keyof PriorityFactors> = [
  "capacityAtV1",
  "unmetTarget",
  "winRateCustomerOem",
  "isLiveProgram",
  "hasProgramIncumbency",
  "hasProgramCustomerIncumbency",
];

/**
 * Returns the ordered list of factor keys that are considered "present"
 * for a given `PriorityFactors` bundle.
 *
 *   - `winRateCustomerOem` is present when its value is ≥ 0.5.
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
    if (key === "winRateCustomerOem") return value >= 0.5;
    return value === 1;
  });
}

/** Shape returned by the batched hook. */
export interface PriorityData {
  /** Map from packageId → priority score */
  scores: Map<string, number>;
  /** Map from packageId → the six factor values (may include nullish values) */
  factors: Map<string, PriorityFactors>;
}

/**
 * Fetches all PendingRfqPriority records once and exposes both the
 * priorityScore lookup and the six per-package priority factors used by
 * the priority-factors tooltip.
 *
 * Both maps are stable across re-renders unless `refreshToken` changes.
 * Returns empty maps while loading or on error (non-critical data).
 */
export function usePriorityData(refreshToken?: number): PriorityData {
  const [data, setData] = useState<PriorityData>({ scores: new Map(), factors: new Map() });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const scores = new Map<string, number>();
        const factors = new Map<string, PriorityFactors>();
        let token: string | undefined;
        do {
          const page = await client(PendingRfqPriority).fetchPage({
            $pageSize: FETCH_PAGE_SIZE,
            ...(token ? { $nextPageToken: token } : {}),
          });
          for (const p of page.data) {
            if (!p.packageId) continue;
            if (p.priorityScore != null) {
              scores.set(p.packageId, p.priorityScore);
            }
            factors.set(p.packageId, {
              capacityAtV1: p.capacityAtV1 ?? null,
              unmetTarget: p.unmetTarget ?? null,
              winRateCustomerOem: p.winRateCustomerOem ?? null,
              isLiveProgram: p.isLiveProgram ?? null,
              hasProgramIncumbency: p.hasProgramIncumbency ?? null,
              hasProgramCustomerIncumbency: p.hasProgramCustomerIncumbency ?? null,
            });
          }
          token = page.nextPageToken;
        } while (token && !cancelled);

        if (cancelled) return;
        setData({ scores, factors });
      } catch {
        // Non-critical — leave data empty
      }
    })();

    return () => { cancelled = true; };
  }, [refreshToken]);

  return data;
}

/**
 * Backwards-compatible convenience wrapper that returns only the score map.
 * New code that needs factor context should use `usePriorityData` directly.
 */
export function usePriorityScores(refreshToken?: number): Map<string, number> {
  return usePriorityData(refreshToken).scores;
}
