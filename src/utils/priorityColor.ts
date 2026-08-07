/**
 * Priority tier for a given priority score.
 *
 * Tiers:
 *   score >= 0.25        → high   (green)
 *   score >= 1/12         → medium (sunflower yellow)
 *   score >  0           → low    (gray)
 *   score <= 0 / null    → low    (gray) — no priority data ≡ Low
 *
 * NOTE: Packages without a `PendingRfqPriority` row (or with a score of 0)
 * default to the "low" tier so that every card gets a color band and is
 * consistent with a "no signal ⇒ Low priority" convention. See
 * `usePriorityScores` for details on when a score can be missing.
 */
export type PriorityTier = "high" | "medium" | "low";

export function getPriorityTier(score: number | null | undefined): PriorityTier {
  if (score != null && score >= 0.25) return "high";
  if (score != null && score >= 1/12) return "medium";
  return "low";
}

/**
 * Human-readable label for a priority tier.
 */
export function getPriorityLabel(tier: PriorityTier): string {
  switch (tier) {
    case "high": return "High";
    case "medium": return "Medium";
    case "low": return "Low";
  }
}

/**
 * Returns a CSS class name (from a caller-provided classes map) for the
 * priority color band based on a priority score. Falls back to the "low"
 * (gray) band when there is no priority data.
 */
export function getPriorityColorClass(
  score: number | null | undefined,
  classes: {
    high: string;
    medium: string;
    low: string;
  },
): string {
  const tier = getPriorityTier(score);
  return classes[tier];
}

/** Ascending tier rank: High sorts first (0), then Medium (1), then Low (2). */
const TIER_RANK: Record<PriorityTier, number> = { high: 0, medium: 1, low: 2 };

/**
 * Compares two priority scores by tier (High before Medium before Low), for
 * use as the primary key of a "sort by priority" comparator. Ties within
 * the same tier are NOT broken here — follow up with a secondary
 * comparator (e.g. `compareDueDateAsc`).
 */
export function comparePriorityTier(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  return TIER_RANK[getPriorityTier(a)] - TIER_RANK[getPriorityTier(b)];
}

/**
 * Compares two due-date strings ascending (soonest first); missing due
 * dates sort to the end. Only the date portion (before "T") is compared, so
 * time-of-day differences don't affect ordering.
 */
export function compareDueDateAsc(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aDate = a ? a.split("T")[0] : "";
  const bDate = b ? b.split("T")[0] : "";
  if (aDate === bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  return aDate < bDate ? -1 : 1;
}
