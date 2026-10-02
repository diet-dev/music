import "./style.css";
import { MusicPlayer, musicDefaults } from "@dietdev/music";
import { buildUI } from "./ui.ts";

type TrackId = "menu" | "battle" | "boss";

const player = new MusicPlayer({
  tracks: { menu: "/menu.wav", battle: "/battle.wav", boss: "/boss.wav" },
  onError: (err) => console.error(err),
});

/* Жизненный цикл: грузим всё, хотим «меню» и сразу пробуем resume —
 * если браузер разрешает автовозможность (бывшие жесты со звуком на
 * этом домене), музыка заиграет без клика. Отказ тихо проглатывается
 * внутри resume() — тогда звук разблокируют жесты ниже. */
player.init();
player.loadAll();
player.play("menu");
player.resume();

/* Активация звука жестом: указателю активацию даёт только pointerup
 * (pointerdown для пальца не считается), клавиатуре — keydown. */
window.addEventListener("pointerup", wake, { once: true });
window.addEventListener("keydown", wake, { once: true });

/* Скрытая вкладка — независимая причина молчать (и повод усыпить контекст). */
document.addEventListener("visibilitychange", () => {
  player.setSuspended("hidden", document.hidden);
});

let current: TrackId | null = "menu";
let paused = false;
let ad = false;
let enabled = true;
let rate = 1;
let started = false;

const ui = buildUI(document.getElementById("app")!, {
  tracks: [
    { id: "menu", label: "Меню" },
    { id: "battle", label: "Батл" },
    { id: "boss", label: "Босс" },
  ],
  minRate: musicDefaults.minRate,
  onTrack(id) {
    wake();
    if (current === id) {
      player.stop();
      current = null;
    } else {
      current = id as TrackId;
      player.play(id);
    }
    render();
  },
  onPause(on) {
    wake();
    paused = on;
    player.duck(on);
    render();
  },
  onAd(on) {
    wake();
    ad = on;
    player.setSuspended("ad", on);
    render();
  },
  onRate(v) {
    wake();
    rate = v;
    player.setRate(v);
    render();
  },
  onEnabled(on) {
    enabled = on;
    if (on) {
      wake();
      player.setEnabled(true);
    } else {
      player.setEnabled(false);
    }
    render();
  },
});

function render(): void {
  ui.render({ current, paused, ad, enabled, rate });
}

function wake(): void {
  player.init();
  if (!started) {
    started = true;
    ui.dismissHint();
  }
  player.resume();
}

render();
