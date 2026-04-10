/**
 * Comparator for sorting tools by toolNumber numerically.
 * Falls back to lexicographic comparison for non-numeric values,
 * and pushes null/undefined toolNumbers to the end.
 */
export function compareToolNumber(
  a: string | undefined,
  b: string | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const numA = Number(a);
  const numB = Number(b);
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
  return a.localeCompare(b);
}
