import { useEffect, useState } from "react";
import { Employee } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import {
  ELIGIBLE_ESTIMATOR_EMAILS,
  ELIGIBLE_ESTIMATOR_EMAIL_SET,
} from "../utils/eligibleEstimators";

export interface EligibleEstimator {
  /** Employee primary key — this is what `RfqPackage.assignedTo` stores */
  id: string;
  /** Display-friendly name; falls back to email if no name is set */
  name: string;
  email: string | null;
  jobTitle: string | null;
}

/** Module-level cache so multiple consumers share one network request */
let cachedEstimators: EligibleEstimator[] | null = null;
let inFlight: Promise<EligibleEstimator[]> | null = null;

function resolveName(emp: Osdk.Instance<Employee>): string {
  if (emp.displayName && emp.displayName.trim() !== "") return emp.displayName;
  const combined = [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim();
  if (combined !== "") return combined;
  return emp.companyEmail ?? String(emp.$primaryKey);
}

async function fetchEligibleEstimators(): Promise<EligibleEstimator[]> {
  const page = await client(Employee)
    .where({
      $and: [
        { active: { $eq: true } },
        { companyEmail: { $in: ELIGIBLE_ESTIMATOR_EMAILS } },
      ],
    })
    .fetchPage({ $pageSize: 100 });

  const filtered = page.data.filter(
    (e) =>
      e.companyEmail && ELIGIBLE_ESTIMATOR_EMAIL_SET.has(e.companyEmail.toLowerCase()),
  );

  const result: EligibleEstimator[] = filtered.map((e) => ({
    id: String(e.$primaryKey),
    name: resolveName(e),
    email: e.companyEmail ?? null,
    jobTitle: e.jobTitle ?? null,
  }));
  result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return result;
}

/**
 * Loads the fixed allowlist of estimator employees eligible to be assigned to
 * packages, exposed with each employee's primary key + display name.
 *
 * Results are cached at module scope so this is safe to use in multiple
 * components without duplicate network requests.
 */
export function useEligibleEstimators(): {
  estimators: EligibleEstimator[];
  loading: boolean;
  error: string | null;
} {
  const [estimators, setEstimators] = useState<EligibleEstimator[]>(
    cachedEstimators ?? [],
  );
  const [loading, setLoading] = useState(cachedEstimators === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedEstimators) return;
    let cancelled = false;

    (async () => {
      try {
        if (!inFlight) {
          inFlight = fetchEligibleEstimators();
        }
        const result = await inFlight;
        cachedEstimators = result;
        if (!cancelled) {
          setEstimators(result);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load estimators");
          setLoading(false);
        }
      } finally {
        inFlight = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { estimators, loading, error };
}
