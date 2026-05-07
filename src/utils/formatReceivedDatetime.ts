/**
 * Formats an ISO timestamp string (e.g. "2026-05-06T14:15:00Z") into
 * "May 06 2026 02:15 PM" format.
 *
 * If `iso` is missing, falls back to `dateFallback` (a date-only string like "2026-05-06")
 * and displays it as "May 06 2026" (no time component).
 *
 * Returns "—" if both values are missing.
 */
export function formatReceivedDatetime(
  iso: string | undefined,
  dateFallback?: string | undefined,
): string {
  if (iso) {
    try {
      const date = new Date(iso);
      if (isNaN(date.getTime())) return "—";

      const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      const month = months[date.getMonth()];
      const day = String(date.getDate()).padStart(2, "0");
      const year = date.getFullYear();

      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      const hh = String(hours).padStart(2, "0");

      return `${month} ${day} ${year} ${hh}:${minutes} ${ampm}`;
    } catch {
      return "—";
    }
  }

  // Fallback: date-only string (e.g. "2026-05-06") → "May 06 2026"
  if (dateFallback) {
    try {
      const parts = dateFallback.split("T")[0].split("-");
      const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (isNaN(local.getTime())) return "—";

      const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      const month = months[local.getMonth()];
      const day = String(local.getDate()).padStart(2, "0");
      const year = local.getFullYear();

      return `${month} ${day} ${year}`;
    } catch {
      return "—";
    }
  }

  return "—";
}
