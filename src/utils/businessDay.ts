/**
 * Whether a date string falls on today or the most recent prior business
 * day. That's "yesterday" most days, but weekends don't count as business
 * days: on a Monday the most recent prior business day is the preceding
 * Friday, and on a Sunday it's also the preceding Friday.
 */
export function isWithinLastBusinessDay(dateStr: string | undefined | null, now: Date = new Date()): boolean {
  if (!dateStr) return false;

  const parts = dateStr.split("T")[0].split("-");
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(date.getTime())) return false;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDow = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysToPriorBusinessDay = todayDow === 0 ? 2 : todayDow === 1 ? 3 : 1;

  const priorBusinessDay = new Date(today);
  priorBusinessDay.setDate(priorBusinessDay.getDate() - daysToPriorBusinessDay);

  return date.getTime() === today.getTime() || date.getTime() === priorBusinessDay.getTime();
}
