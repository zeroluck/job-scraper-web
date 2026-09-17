export const WORD_CLOUD_MIN_FONT = 10;
export const WORD_CLOUD_MAX_FONT = 64;
export const WORD_CLOUD_ANIMATION_DELAY_STEP_MS = 10;
export const WORD_CLOUD_MAX_ANIMATION_DELAY_MS = 600;

export type WordCloudSpread = { label: string; min: number; max: number };

export const WORD_CLOUD_SPREAD_PRESETS: readonly WordCloudSpread[] = [
  { label: "Narrow", min: 18, max: 44 },
  { label: "Balanced", min: 14, max: 56 },
  { label: "Wide", min: 10, max: 64 },
  { label: "Extra", min: 8, max: 80 },
];
export const DEFAULT_SPREAD_INDEX = 2;

export type WordCloudLevels = { label: string; levels: number };

export const WORD_CLOUD_LEVEL_PRESETS: readonly WordCloudLevels[] = [
  { label: "Smooth", levels: 0 },
  { label: "3 levels", levels: 3 },
  { label: "5 levels", levels: 5 },
  { label: "8 levels", levels: 8 },
];
export const DEFAULT_LEVEL_INDEX = 0;

export function computeWordFontSize(
  count: number,
  minCount: number,
  maxCount: number,
  fontMin: number = WORD_CLOUD_MIN_FONT,
  fontMax: number = WORD_CLOUD_MAX_FONT,
): number {
  if (
    !Number.isFinite(count) ||
    !Number.isFinite(minCount) ||
    !Number.isFinite(maxCount) ||
    !Number.isFinite(fontMin) ||
    !Number.isFinite(fontMax) ||
    maxCount <= minCount ||
    fontMax <= fontMin
  ) {
    return Math.round((fontMin + fontMax) / 2);
  }
  const clamped = Math.min(Math.max(count, minCount), maxCount);
  const sqrtMin = Math.sqrt(minCount);
  const sqrtMax = Math.sqrt(maxCount);
  if (!(sqrtMax > sqrtMin)) {
    return Math.round((fontMin + fontMax) / 2);
  }
  const normalized = (Math.sqrt(clamped) - sqrtMin) / (sqrtMax - sqrtMin);
  return Math.round(fontMin + normalized * (fontMax - fontMin));
}

export function quantizeFontSize(
  size: number,
  fontMin: number,
  fontMax: number,
  levels: number,
): number {
  if (!Number.isFinite(size) || !Number.isFinite(levels) || levels < 2) {
    return size;
  }
  const step = (fontMax - fontMin) / (levels - 1);
  if (!(step > 0)) return size;
  return Math.round(fontMin + Math.round((size - fontMin) / step) * step);
}

export function getWordAnimationDelay(index: number): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(
    Math.floor(index) * WORD_CLOUD_ANIMATION_DELAY_STEP_MS,
    WORD_CLOUD_MAX_ANIMATION_DELAY_MS,
  );
}
