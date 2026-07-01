import { useEffect, useState } from "react";
import { PendingRfqPriority } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";

const FETCH_PAGE_SIZE = 200;

/**
 * Fetches all PendingRfqPriority records and returns a map from
 * PendingRfqPackage packageId → priorityScore.
 *
 * The map is stable across re-renders unless `refreshToken` changes.
 * Returns an empty map while loading or on error (non-critical data).
 */
export function usePriorityScores(refreshToken?: number): Map<string, number> {
  const [scores, setScores] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const results: Array<{ packageId: string; priorityScore: number }> = [];
        let token: string | undefined;
        do {
          const page = await client(PendingRfqPriority).fetchPage({
            $pageSize: FETCH_PAGE_SIZE,
            ...(token ? { $nextPageToken: token } : {}),
          });
          for (const p of page.data) {
            if (p.packageId && p.priorityScore != null) {
              results.push({ packageId: p.packageId, priorityScore: p.priorityScore });
            }
          }
          token = page.nextPageToken;
        } while (token && !cancelled);

        if (cancelled) return;
        const map = new Map<string, number>();
        for (const { packageId, priorityScore } of results) {
          map.set(packageId, priorityScore);
        }
        setScores(map);
      } catch {
        // Non-critical — leave scores empty
      }
    })();

    return () => { cancelled = true; };
  }, [refreshToken]);

  return scores;
}
