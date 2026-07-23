export const DEFAULT_TTS_SPEED = 1.1;

export function normalizeSpeed(value: unknown, fallback = DEFAULT_TTS_SPEED): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.5, Math.min(2, n));
}

export function buildAtempoFilter(speed: number): string {
  const parts: number[] = [];
  let remaining = normalizeSpeed(speed);
  if (Math.abs(remaining - 1) < 0.001) return "atempo=1";
  while (remaining > 2) {
    parts.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push(0.5);
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.001) parts.push(remaining);
  if (!parts.length) parts.push(1);
  return parts.map((v) => `atempo=${v.toFixed(6)}`).join(",");
}
