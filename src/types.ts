/**
 * Причина промолчать: реклама, скрытая вкладка. Причины независимы — каждая
 * снимается сама по себе, и одна не должна перебивать другую (возврат из
 * рекламы не включает музыку тому, кто выключил её в настройках — это
 * отдельный флаг setEnabled()).
 */
export type SuspendSource = "ad" | "hidden";

/** Опции плеера. Всё, кроме `tracks`, имеет разумный дефолт — см. `musicDefaults`. */
export type MusicOptions = {
  /**
   * Треки: id → URL. Порядок ключей — порядок приоритета загрузки в
   * `loadAll()`: первый трек нужен раньше всех, последний — позже всех.
   */
  tracks: Record<string, string>;

  /** Целевая громкость мастера, 0..1. */
  volume?: number;
  /** Длительность кроссфейда между треками, сек. */
  crossfade?: number;
  /** Множитель громкости на паузе и на модалках (`duck()`). */
  duckLevel?: number;
  /** Частота lowpass на паузе, Гц — эффект «ушло под воду». */
  duckHz?: number;
  /** Частота lowpass в обычном состоянии: фильтр фактически выключен. */
  openHz?: number;
  /** Длительность короткой рампы любых мгновенных изменений, сек. */
  ramp?: number;
  /** Частота lowpass в нижней точке замедления (rate === minRate), Гц. */
  slomoFilterHz?: number;
  /** Нижняя граница playbackRate: ниже музыка превращается в кашу. */
  minRate?: number;

  /**
   * Куда уходят ошибки (сеть, decode, отсутствующий трек). Плеер никогда
   * не бросает исключения наружу: музыка не должна ронять игру.
   */
  onError?: (err: unknown) => void;
};

/** Дефолты. */
export const musicDefaults = {
  volume: 0.35,
  crossfade: 0.6,
  duckLevel: 0.3,
  duckHz: 400,
  openHz: 20000,
  ramp: 0.08,
  slomoFilterHz: 2500,
  minRate: 0.7,
} as const satisfies Omit<MusicOptions, "tracks" | "onError">;
