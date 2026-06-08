/**
 * Comparator for sorting tools by toolNumber numerically.
 * Falls back to lexicographic comparison for non-numeric values,
 * and pushes null/undefined toolNumbers to the end.
 * An optional tiebreaker value is used when the primary values are equal.
 */
export function compareToolNumber(
  a: string | undefined,
  b: string | undefined,
  tiebreakA?: string | undefined,
  tiebreakB?: string | undefined,
): number {
  if (a == null && b == null) {
    // fall through to tiebreak
  } else {
    if (a == null) return 1;
    if (b == null) return -1;
    const numA = Number(a);
    const numB = Number(b);
    const primary = (!isNaN(numA) && !isNaN(numB)) ? numA - numB : a.localeCompare(b);
    if (primary !== 0) return primary;
  }
  // Primary values are equal (or both null) — apply tiebreak
  if (tiebreakA == null && tiebreakB == null) return 0;
  if (tiebreakA == null) return 1;
  if (tiebreakB == null) return -1;
  const numTA = Number(tiebreakA);
  const numTB = Number(tiebreakB);
  if (!isNaN(numTA) && !isNaN(numTB)) return numTA - numTB;
  return tiebreakA.localeCompare(tiebreakB);
}
