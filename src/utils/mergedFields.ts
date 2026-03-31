/**
 * Delimiter used by the mergePackages action to concatenate
 * From, To, Subject, and Body Content when two packages are merged.
 */
const MERGE_DELIMITER = "|:~:|";

/**
 * Splits a potentially merged field value into its constituent segments.
 * Returns a single-element array for non-merged values.
 */
export function splitMergedField(value: string | undefined | null): string[] {
  if (!value) return [];
  const parts = value.split(MERGE_DELIMITER).map((s) => s.trim());
  return parts.filter((p) => p.length > 0);
}

/**
 * Returns true if any of the given field values contain the merge delimiter,
 * meaning this package is the result of a merge.
 */
export function isMergedPackage(
  ...fields: (string | undefined | null)[]
): boolean {
  return fields.some((f) => f != null && f.includes(MERGE_DELIMITER));
}
