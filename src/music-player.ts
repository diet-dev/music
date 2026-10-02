import { slomoFilterHz, targetGain } from "./gain.ts";
import { musicDefaults, type MusicOptions, type SuspendSource } from "./types.ts";

type AudioContextCtor = new () => AudioContext;

type ResolvedOptions = Required<Omit<MusicOptions, "tracks" | "onError">> & Pick<MusicOptions, "tracks" | "onError">;

// Слот живёт от play() до фактической остановки source.onended — дольше, чем
// идёт кроссфейд. Свой GainNode на источник и список fading вместо пары
// фиксированных слотов: затухающий источник не переиспользуется новым play().
type Slot = {
  gain: GainNode;
  source: AudioBufferSourceNode;
  track: string;
};

/**
 * Зацикленные треки на Web Audio: кроссфейд между треками, приглушение
 * (пауза/модалки), независимые причины молчания (реклама, скрытая вкладка,
 * настройка), темп с приопусканием фильтра (слоу-мо).
 *
 * Плеер не бросает исключений: всё уходит в `onError`. Музыка не должна
 * ронять игру.
 */
export class MusicPlayer {
  private readonly tracks: Record<string, string>;
  private readonly opt: ResolvedOptions;

  private ctx?: AudioContext;
  private filter?: BiquadFilterNode;
  private master?: GainNode;
  private current?: Slot;
  private fading: Slot[] = [];

  private buffers: { [key: string]: AudioBuffer } = {};
  // `| undefined` в значении обязателен: без него TS считает индексный доступ
  // всегда определённым и ругается на "if (this.loading[track])" как на
  // всегда-истинное условие (TS2801).
  private loading: { [key: string]: Promise<void> | undefined } = {};

  // Три независимых источника глушения. Сводить их к одному флагу нельзя:
  // иначе возврат из рекламы включит музыку тому, кто выключил её в настройках.
  private enabled: boolean = true;
  private suspended: { [key in SuspendSource]: boolean } = { ad: false, hidden: false };
  private ducked: boolean = false;

  private rate: number = 1;
  private wanted?: string;

  constructor(options: MusicOptions) {
    this.tracks = options.tracks;
    this.opt = {
      ...musicDefaults,
      ...options,
    };
  }

  /**
   * Создаёт AudioContext. Вызывать можно откуда угодно, жест не нужен:
   * контекст рождается suspended, и это законно. Без него не работает
   * decodeAudioData, поэтому init() обязателен до фактического декода.
   */
  public init(): void {
    if (this.ctx) return;

    try {
      // Safari до 14.1 прячет конструктор за webkitAudioContext
      const w = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
      const Ctx = w.AudioContext || w.webkitAudioContext;
      if (!Ctx) return;

      const ctx: AudioContext = new Ctx();
      const master: GainNode = ctx.createGain();
      const filter: BiquadFilterNode = ctx.createBiquadFilter();

      filter.type = "lowpass";
      filter.frequency.value = this.opt.openHz;
      master.gain.value = 0;

      filter.connect(master);
      master.connect(ctx.destination);

      this.ctx = ctx;
      this.filter = filter;
      this.master = master;

      // Состояние могло быть выставлено до init() — теперь доигрываем оба
      // хвоста: фильтр (частота требует init()) и желаемый трек.
      this.duck(this.ducked);
      if (this.wanted) this.play(this.wanted);
    } catch (err) {
      this.fail(err);
    }
  }

  /**
   * Снимает suspended. Вызывать из обработчика пользовательского жеста —
   * или из любого перехода в состояние «можно играть» (см. maybeResume()):
   * если жеста ещё не было, браузер просто отклонит resume(), это штатно
   * и проглатывается catch() ниже.
   */
  public resume(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const started = (): void => {
      // Трек мог быть запрошен, пока контекст спал.
      if (this.wanted) this.play(this.wanted);
    };

    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(started)
        .catch(() => {});
    } else {
      started();
    }
  }

  public load(track: string): Promise<void> {
    const url = this.tracks[track];
    if (!url) {
      this.fail(new Error(`MusicPlayer.load(${track}): неизвестный трек`));
      return Promise.resolve();
    }
    if (this.buffers[track]) return Promise.resolve();
    if (this.loading[track]) return this.loading[track] as Promise<void>;

    this.loading[track] = fetch(url)
      .then((res: Response) => {
        if (!res.ok) {
          throw new Error(`MusicPlayer.load(${track}): HTTP ${res.status}`);
        }
        return res.arrayBuffer();
      })
      .then((raw: ArrayBuffer) => this.decode(raw))
      .then((buffer: AudioBuffer) => {
        this.buffers[track] = buffer;
        // Трек мог быть запрошен, пока грузился, — и всё ещё актуален.
        if (this.wanted === track) this.play(track);
      })
      .catch((err: unknown) => {
        // Промис загрузки выброшен: повторный load() попробует снова,
        // а не вернёт навсегда упавшую загрузку.
        delete this.loading[track];
        this.fail(err);
      });

    return this.loading[track] as Promise<void>;
  }

  /**
   * Очередь по приоритету: треки грузятся последовательно в порядке
   * объявления в `options.tracks`. Ничего не тянет, пока музыка выключена
   * настройкой (enabled === false) или ещё нет AudioContext (init() не
   * вызывался) — иначе у игрока с выключенной музыкой сессия всё равно
   * качала бы все треки. Сама подтягивает всё заново, когда музыку
   * включают — см. setEnabled().
   */
  public loadAll(): Promise<void> {
    if (!this.enabled || !this.ctx) {
      return Promise.resolve();
    }
    let chain: Promise<void> = Promise.resolve();
    for (const track of Object.keys(this.tracks)) {
      chain = chain.then(() => this.load(track));
    }
    return chain;
  }

  public play(track: string): void {
    this.wanted = track;

    // Музыка выключена настройкой — не тянем ассет и не заводим источник:
    // иначе у выключившего музыку игрока всё равно качались бы mp3 и висел бы
    // AudioContext. wanted запомнен выше — setEnabled(true) доиграет трек.
    if (!this.enabled) {
      return;
    }
    try {
      const ctx = this.ctx;
      const filter = this.filter;
      const buffer = this.buffers[track];

      if (!ctx || !filter) return;

      // Трек ещё не загружен — включим по готовности (см. load()).
      if (!buffer) {
        this.load(track);
        return;
      }
      // Контекст спит — стартовать источник незачем: wanted включит resume().
      // Так поведение не зависит от обработки автоматики на спящем контексте.
      if (ctx.state === "suspended") return;

      if (this.current && this.current.track === track) return;

      const now: number = ctxNow(ctx);

      if (this.current) this.fadeOut(this.current, now);

      // Свой GainNode на источник: затухающий не пересекается со следующим
      // play(), даже если тот случится раньше реальной остановки.
      const gain: GainNode = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(filter);

      const source: AudioBufferSourceNode = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = this.rate;
      source.connect(gain);
      source.start(0);

      const { crossfade } = this.opt;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + crossfade);

      this.current = { gain, source, track };
      this.applyGain();
    } catch (err) {
      // Музыка никогда не роняет игру.
      this.fail(err);
    }
  }

  /** Уводит текущий трек в кроссфейд-затухание и забывает его. */
  public stop(): void {
    this.wanted = undefined;

    const ctx = this.ctx;
    if (!ctx || !this.current) return;

    this.fadeOut(this.current, ctx.currentTime);
    this.current = undefined;
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyGain();

    if (on) {
      this.maybeResume();
      // Пока музыка была выключена, play()/loadAll() не тянули ассеты, а wanted
      // мог разойтись с current — наверстываем: треки и переигровку (идемпотентно).
      this.loadAll();
      if (this.wanted) this.play(this.wanted);
    }
  }

  public setSuspended(source: SuspendSource, on: boolean): void {
    this.suspended[source] = on;
    this.applyGain();

    // Скрытая вкладка — усыпляем контекст целиком, чтобы не жечь батарею.
    if (source === "hidden" && this.ctx && on) {
      this.ctx.suspend().catch(() => {});
    }

    // Причин молчать несколько (ad, hidden, настройки), снимаются независимо.
    // Пробуждаем контекст на любое снятие, не только hidden: иначе конец
    // рекламы после скрытой вкладки не разбудит контекст.
    if (!on) this.maybeResume();
  }

  public duck(on: boolean): void {
    this.ducked = on;
    this.applyGain();

    if (!this.ctx || !this.filter) return;
    const { duckHz, openHz, ramp } = this.opt;
    const now: number = ctxNow(this.ctx);
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
    this.filter.frequency.linearRampToValueAtTime(on ? duckHz : openHz, now + ramp * 2);
  }

  public setRate(rate: number): void {
    this.rate = rate;
    if (!this.ctx) return;

    const now: number = ctxNow(this.ctx);
    // Темп применяем и к затухающим источникам тоже — иначе на резком слоу-мо
    // ещё звучащий хвост предыдущего трека останется в чужом темпе.
    const slots: Slot[] = this.current ? [this.current, ...this.fading] : this.fading;
    slots.forEach((slot: Slot) => {
      slot.source.playbackRate.cancelScheduledValues(now);
      slot.source.playbackRate.setValueAtTime(slot.source.playbackRate.value, now);
      slot.source.playbackRate.linearRampToValueAtTime(rate, now + this.opt.ramp);
    });

    // Приопускаем lowpass вместе с темпом — вместе с падением playbackRate
    // читается как «звук уходит».
    this.applySlomoFilter(rate, now);
  }

  /**
   * Двигает lowpass вслед за темпом замедления. duck() приоритетнее и не
   * полагается на порядок вызовов: пока музыка приглушена паузой/модалкой
   * (this.ducked), слоу-мо вообще не трогает фильтр — иначе setRate(),
   * вызванный по остаточному кадру уже после паузы, перебил бы фильтр
   * duck() обратно к почти открытому.
   */
  private applySlomoFilter(rate: number, now: number): void {
    if (!this.filter || this.ducked) return;

    const { minRate, openHz, slomoFilterHz: closedHz, ramp } = this.opt;
    const hz: number = slomoFilterHz(rate, minRate, openHz, closedHz);

    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
    this.filter.frequency.linearRampToValueAtTime(hz, now + ramp);
  }

  /** Дев-хук: громкость мимо обычных рамп, мгновенно — для подбора значений из консоли. */
  public debugVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  /** Дев-хук: частота lowpass мимо обычных рамп, мгновенно. */
  public debugFilter(hz: number): void {
    if (this.filter) this.filter.frequency.value = hz;
  }

  private shouldPlay(): boolean {
    return this.enabled && !this.suspended.ad && !this.suspended.hidden;
  }

  /** Пробуждает контекст, если все причины молчать уже сняты. Безопасно
   * звать откуда угодно — сама решает, нужно ли что-то делать. */
  private maybeResume(): void {
    if (this.shouldPlay()) this.resume();
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;

    const { volume, duckLevel, ramp } = this.opt;
    const target: number = targetGain(this.shouldPlay(), this.ducked, volume, duckLevel);
    const now: number = ctxNow(this.ctx);

    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(target, now + ramp * 2);
  }

  /**
   * Уводит слот в затухание: он остаётся в графе и звучит ещё crossfade+0.05с,
   * но больше не является this.current — следующий play() его не тронет.
   * Полностью отключается от графа сам, когда source.onended реально
   * сработает, а не в момент вызова fadeOut(): раньше слот считался свободным
   * сразу, хотя источник ещё звучал.
   */
  private fadeOut(slot: Slot, now: number): void {
    const source: AudioBufferSourceNode = slot.source;
    const stopAt: number = now + this.opt.crossfade + 0.05;

    slot.gain.gain.cancelScheduledValues(now);
    slot.gain.gain.setValueAtTime(slot.gain.gain.value, now);
    slot.gain.gain.linearRampToValueAtTime(0, now + this.opt.crossfade);

    source.onended = (): void => {
      try {
        source.disconnect();
        slot.gain.disconnect();
      } catch (err) {
        // Узел мог быть уже отключён — не повод падать.
      }
      const idx: number = this.fading.indexOf(slot);
      if (idx !== -1) this.fading.splice(idx, 1);
    };

    try {
      source.stop(stopAt);
    } catch (err) {
      // Уже остановлен — не повод падать.
    }

    this.fading.push(slot);
  }

  /** decodeAudioData в старом Safari не возвращает промис. */
  private decode(raw: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ctx;
    if (!ctx) return Promise.reject(new Error("no AudioContext"));

    return new Promise((resolve, reject) => {
      // @ts-ignore  старый Safari вызывает колбэки и возвращает undefined
      const result: any = ctx.decodeAudioData(raw, resolve, reject);
      if (result && typeof result.then === "function") result.then(resolve, reject);
    });
  }

  private fail(err: unknown): void {
    if (this.opt.onError) {
      this.opt.onError(err);
      return;
    }
    console.error(err);
  }
}

/** currentTime на спящем контексте не двигается; отдельная обёртка — точка,
 * куда когда-нибудь встанет мок-часы для тестов графа. */
function ctxNow(ctx: AudioContext): number {
  return ctx.currentTime;
}
