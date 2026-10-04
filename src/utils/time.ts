export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 10_000) return 'teraz';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} s temu`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min temu`;
  const d = new Date(ts);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return formatTime(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "03.10.2026" */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** "03.10.2026, 14:05" */
export const formatDateTime = (ts: number) => `${formatDate(ts)}, ${formatTime(ts)}`;

export const sleep =(ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Random integer in [min, max]. */
export const jitter = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
