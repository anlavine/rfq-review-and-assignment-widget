/**
 * Returns an HSL color string that interpolates from red (0) → yellow (50) → green (100)
 * based on a confidence score from 0–100.
 */
export function getConfidenceColor(score: number): string {
  // Clamp to 0–100
  const clamped = Math.max(0, Math.min(100, score));
  // Map 0–100 → hue 0 (red) to 120 (green), passing through 60 (yellow) at 50
  const hue = (clamped / 100) * 120;
  return `hsl(${hue}, 80%, 38%)`;
}
