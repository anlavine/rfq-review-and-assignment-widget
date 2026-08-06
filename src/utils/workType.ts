export type WorkTypeCategory = "new" | "engChange" | "other" | null;

/** Returns "new", "engChange", "other", or null based on a package's work type. */
export function categorizeWorkType(workType: string | undefined): WorkTypeCategory {
  if (!workType) return null;
  const lower = workType.toLowerCase();
  if (lower.includes("new build") || lower.includes("new_build") || lower === "new") return "new";
  if (lower.includes("eng change") || lower.includes("engineering change") || lower.includes("eng_change")) return "engChange";
  return "other";
}
