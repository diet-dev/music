/**
 * Чистая математика громкости и фильтра — без Web Audio и таймеров, поэтому
 * проверяется юнит-тестами в Node, где AudioContext нет.
 */

/** Целевая громкость мастера: audible и duck умножаются, молчание — ноль. */
export function targetGain(audible: boolean, ducked: boolean, volume: number, duckLevel: number): number {
  if (!audible) return 0;
  return volume * (ducked ? duckLevel : 1);
}

/**
 * Частота lowpass вслед за темпом замедления: при rate === 1 фильтр открыт
 * (openHz), при rate === minRate приопущен до slomoHz, между ними — линейно.
 * Вне диапазона — клампится: замедление слабее единицы фильтр не открывает
 * шире обычного, а глубже minRate не душит сильнее нижней точки.
 */
export function slomoFilterHz(rate: number, minRate: number, openHz: number, slomoHz: number): number {
  const t: number = Math.max(0, Math.min(1, (1 - rate) / (1 - minRate)));
  return openHz + t * (slomoHz - openHz);
}
