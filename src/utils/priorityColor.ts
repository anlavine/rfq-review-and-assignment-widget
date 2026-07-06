/**
 * Returns a CSS class name (from a caller-provided classes map) for the
 * priority color band based on a priority score.
 *
 * Tiers:
 *   score >= 0.6 → green
 *   score >= 0.3 → yellow-green
 *   score > 0    → yellow
 *   score <= 0   → no color (empty string)
 */
export function getPriorityColorClass(
  score: number | null | undefined,
  classes: {
    orange: string;
    yellow: string;
    gray: string;
  },
): string {
  if (score == null || score <= 0) return "";
  if (score >= 0.6) return classes.orange;
  if (score >= 0.3) return classes.yellow;
  return classes.gray;
}
