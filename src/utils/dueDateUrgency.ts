/**
 * Returns a due-date urgency level for Active packages.
 *   - "overdue"  → due date is in the past
 *   - "dueSoon"  → due date is today or tomorrow
 *   - null       → no urgency (not Active, no due date, or > 1 day out)
 */
export function getDueDateUrgency(
  dueDate: string | undefined,
  completionStatus: string | undefined
): "overdue" | "dueSoon" | null {
  if (completionStatus !== "Active" || !dueDate) return null;
  try {
    // Parse as local date to avoid UTC timezone shift
    const parts = dueDate.split("T")[0].split("-");
    const dueDay = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays =
      (dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return "overdue";
    if (diffDays <= 1) return "dueSoon";
  } catch {
    // ignore parse errors
  }
  return null;
}
