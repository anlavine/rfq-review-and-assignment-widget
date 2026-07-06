/**
 * Priority tier for a given priority score.
 *
 * Tiers:
 *   score >= 0.6 → high   (orange)
 *   score >= 0.3 → medium (yellow)
 *   score > 0    → low    (gray)
 *   score <= 0 / null     → none
 */
export type PriorityTier = "high" | "medium" | "low" | "none";

export function getPriorityTier(score: number | null | undefined): PriorityTier {
  if (score == null || score <= 0) return "none";
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

/**
 * Human-readable label for a priority tier (or empty string for "none").
 */
export function getPriorityLabel(tier: PriorityTier): string {
  switch (tier) {
    case "high": return "High";
    case "medium": return "Medium";
    case "low": return "Low";
    default: return "";
  }
}

/**
 * Returns a CSS class name (from a caller-provided classes map) for the
 * priority color band based on a priority score.
 */
export function getPriorityColorClass(
  score: number | null | undefined,
  classes: {
    orange: string;
    yellow: string;
    gray: string;
  },
): string {
  const tier = getPriorityTier(score);
  if (tier === "high") return classes.orange;
  if (tier === "medium") return classes.yellow;
  if (tier === "low") return classes.gray;
  return "";
}
