import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MusicPlayer } from "../src/music-player.ts";

/** В Node нет AudioContext: init() молча выходит, и все методы проверяются
 * как «не бросают и не делают лишнего». Граф проверяется вручную в браузере. */
describe("MusicPlayer без AudioContext", () => {
  it("init() не бросает и повторный вызов — тоже", () => {
    const player = new MusicPlayer({ tracks: { menu: "menu.mp3" } });
    player.init();
    player.init();
  });

  it("play/stop/duck/setRate/setSuspended до init() не бросают", () => {
    const player = new MusicPlayer({ tracks: { menu: "menu.mp3" } });
    player.play("menu");
    player.stop();
    player.duck(true);
    player.duck(false);
    player.setRate(0.8);
    player.setSuspended("ad", true);
    player.setSuspended("ad", false);
  });

  it("play() до init() не тянет трек по сети", (t) => {
    const fetched = stubFetch(t);

    const player = new MusicPlayer({ tracks: { menu: "menu.mp3" } });
    player.play("menu");

    assert.deepEqual(fetched(), []);
  });

  it("loadAll() до init() ничего не грузит", async (t) => {
    const fetched = stubFetch(t);

    const player = new MusicPlayer({ tracks: { menu: "menu.mp3", battle: "battle.mp3" } });
    await player.loadAll();

    assert.deepEqual(fetched(), []);
  });

  it("выключенная настройкой музыка не тянет треки", async (t) => {
    const fetched = stubFetch(t);

    const player = new MusicPlayer({ tracks: { menu: "menu.mp3" } });
    player.setEnabled(false);
    player.play("menu");
    await player.loadAll();

    assert.deepEqual(fetched(), []);
  });

  it("неизвестный трек уходит в onError без fetch", async (t) => {
    stubFetch(t);
    const errors: unknown[] = [];

    const player = new MusicPlayer({ tracks: {}, onError: (e) => errors.push(e) });
    // play() без контекста только запоминает желание; ошибку трека отдаёт load()
    await player.load("nope");

    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /неизвестный трек/);
  });

  it("упавшая загрузка не кэшируется: повторный load() тянет снова", async (t) => {
    const fetched = stubFetch(t);
    const errors: unknown[] = [];

    const player = new MusicPlayer({ tracks: { menu: "menu.mp3" }, onError: (e) => errors.push(e) });

    await player.load("menu");
    await player.load("menu");

    // fetch отработал дважды; декод упал оба раза — в Node нет AudioContext,
    // и это ровно та ошибка, которая должна дойти до onError
    assert.deepEqual(fetched(), ["menu.mp3", "menu.mp3"]);
    assert.equal(errors.length, 2);
    assert.match(String(errors[0]), /no AudioContext/);
  });
});

/** Подменяет fetch на стаб, возвращает функцию чтения списка запросов. */
function stubFetch(t: { after: (fn: () => void) => void }): () => string[] {
  const calls: string[] = [];
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as Response;
  }) as typeof fetch;
  return () => calls.slice();
}
