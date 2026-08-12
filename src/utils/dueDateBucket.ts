export type DueDateBucket = "noDueDate" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "later";

export const BUCKET_LABELS: Record<DueDateBucket, string> = {
  noDueDate: "No Due Date",
  today: "Due Today",
  tomorrow: "Due Tomorrow",
  thisWeek: "Due This Week",
  nextWeek: "Due Next Week",
  later: "Due Later",
};

/** Order in which buckets should appear */
export const BUCKET_ORDER: DueDateBucket[] = ["noDueDate", "today", "tomorrow", "thisWeek", "nextWeek", "later"];

/**
 * Assigns a package to a due-date bucket based on the current local date.
 * - No due date → "noDueDate"
 * - Overdue or due today → "today"
 * - Due tomorrow → "tomorrow"
 * - Due on or before Sunday of the current week → "thisWeek"
 * - Due on or before Sunday of the following week → "nextWeek"
 * - Everything else → "later"
 */
export function getDueDateBucket(dueDate: string | undefined | null): DueDateBucket {
  if (!dueDate) return "noDueDate";

  const parts = dueDate.split("T")[0].split("-");
  const due = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // End of current week (Sunday). getDay(): 0=Sun, 1=Mon, …, 6=Sat
  const dayOfWeek = today.getDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);

  // End of next week (the following Sunday)
  const endOfNextWeek = new Date(endOfWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  if (due.getTime() <= today.getTime()) return "today"; // overdue + today
  if (due.getTime() === tomorrow.getTime()) return "tomorrow";
  if (due.getTime() <= endOfWeek.getTime()) return "thisWeek";
  if (due.getTime() <= endOfNextWeek.getTime()) return "nextWeek";
  return "later";
}

/**
 * Comparator for sorting items into bucket order, then ascending due date
 * within the same bucket. Mirrors the Ingestion (Outstanding tab) sort used
 * when grouping by due date.
 */
export function compareDueDateBucket(aDueDate: string | undefined | null, bDueDate: string | undefined | null): number {
  const bucketA = getDueDateBucket(aDueDate);
  const bucketB = getDueDateBucket(bDueDate);
  const orderA = BUCKET_ORDER.indexOf(bucketA);
  const orderB = BUCKET_ORDER.indexOf(bucketB);
  if (orderA !== orderB) return orderA - orderB;
  const dateA = aDueDate ?? "";
  const dateB = bDueDate ?? "";
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return 0;
}
