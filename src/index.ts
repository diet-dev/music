/**
 * @dietdev/music — музыкальный плеер на Web Audio.
 *
 * Публичная точка входа: {@link MusicPlayer} и типы. Плеер ничего не знает
 * о конкретных треках и платформах: треки (id → URL) и все константы
 * инжектятся через опции, ошибки уходят в колбэк `onError`.
 *
 * @packageDocumentation
 */
export { MusicPlayer } from "./music-player.ts";
export { musicDefaults } from "./types.ts";
export type { MusicOptions, SuspendSource } from "./types.ts";
export { targetGain, slomoFilterHz } from "./gain.ts";
