import { useEffect, useMemo, useState } from "react";
import { Employee } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import { resolveEmployeeName } from "../utils/employeeName";

/** Module-level cache + in-flight tracking so a given employee id is fetched at most once per session, shared across all consumers. */
const nameCache = new Map<string, string>();
const inFlight = new Set<string>();

/**
 * Resolves arbitrary employee ids to display names directly from the
 * Employee object, independent of the eligible-estimator allowlist
 * (`useEligibleEstimators`) — that list only covers people eligible for
 * *new* assignments, so an id already assigned to something (someone no
 * longer eligible, or a data inconsistency) would otherwise have no name to
 * render at all. Callers should still use `useEligibleEstimators` for
 * dropdowns/assignment and only pass ids here that it couldn't resolve, so
 * this stays a fallback rather than a duplicate source of truth.
 *
 * Pass the ids you need resolved; each is fetched at most once and cached
 * at module scope for the rest of the session. Returns a Map that only
 * changes reference when the requested id set or the resolved names
 * actually change, so it's safe to use as a dependency elsewhere.
 */
export function useEmployeeNames(ids: (string | null | undefined)[]): Map<string, string> {
  const [version, setVersion] = useState(0);
  const uniqueIds = useMemo(
    () => Array.from(new Set(ids.filter((id): id is string => !!id && id.trim() !== ""))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(",")],
  );

  useEffect(() => {
    const toFetch = uniqueIds.filter((id) => !nameCache.has(id) && !inFlight.has(id));
    if (toFetch.length === 0) return;

    let cancelled = false;
    for (const id of toFetch) inFlight.add(id);

    Promise.all(toFetch.map(async (id) => {
      try {
        const emp = await client(Employee).fetchOne(id);
        nameCache.set(id, resolveEmployeeName(emp));
      } catch {
        // Leave unresolved — id doesn't exist / isn't fetchable.
      } finally {
        inFlight.delete(id);
      }
    })).then(() => {
      if (!cancelled) setVersion((v) => v + 1);
    });

    return () => { cancelled = true; };
  }, [uniqueIds]);

  return useMemo(() => {
    const result = new Map<string, string>();
    for (const id of uniqueIds) {
      const name = nameCache.get(id);
      if (name) result.set(id, name);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueIds, version]);
}
