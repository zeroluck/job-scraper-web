export const WORD_CLOUD_MIN_FONT = 16;
export const WORD_CLOUD_MAX_FONT = 56;
export const WORD_CLOUD_ANIMATION_DELAY_STEP_MS = 10;
export const WORD_CLOUD_MAX_ANIMATION_DELAY_MS = 300;

export function computeWordFontSize(
  count: number,
  minCount: number,
  maxCount: number,
): number {
  if (
    !Number.isFinite(count) ||
    !Number.isFinite(minCount) ||
    !Number.isFinite(maxCount) ||
    maxCount <= minCount
  ) {
    return Math.round((WORD_CLOUD_MIN_FONT + WORD_CLOUD_MAX_FONT) / 2);
  }
  const clamped = Math.min(Math.max(count, minCount), maxCount);
  const sqrtMin = Math.sqrt(minCount);
  const sqrtMax = Math.sqrt(maxCount);
  if (!(sqrtMax > sqrtMin)) {
    return Math.round((WORD_CLOUD_MIN_FONT + WORD_CLOUD_MAX_FONT) / 2);
  }
  const normalized =
    (Math.sqrt(clamped) - sqrtMin) / (sqrtMax - sqrtMin);
  return Math.round(
    WORD_CLOUD_MIN_FONT + normalized * (WORD_CLOUD_MAX_FONT - WORD_CLOUD_MIN_FONT),
  );
}

export function getWordAnimationDelay(index: number): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(
    Math.floor(index) * WORD_CLOUD_ANIMATION_DELAY_STEP_MS,
    WORD_CLOUD_MAX_ANIMATION_DELAY_MS,
  );
}
