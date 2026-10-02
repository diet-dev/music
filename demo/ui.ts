/* UI-слой демки: знает про DOM, не знает про Web Audio. Плеер дёргают
 * колбэки-обработчики, актуальное состояние приходит в render(). */

export type UIOptions = {
  tracks: { id: string; label: string }[];
  minRate: number;
  onTrack(id: string): void;
  onPause(on: boolean): void;
  onAd(on: boolean): void;
  onRate(rate: number): void;
  onEnabled(on: boolean): void;
};

export type UIState = {
  current: string | null;
  paused: boolean;
  ad: boolean;
  enabled: boolean;
  rate: number;
};

export type UI = {
  render(state: UIState): void;
  dismissHint(): void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(root: HTMLElement, title: string): HTMLDivElement {
  const node = el("div", "card");
  node.append(el("h2", undefined, title));
  root.append(node);
  return node;
}

function toggle(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const btn = el("button", "toggle", label);
  btn.onclick = onClick;
  parent.append(btn);
  return btn;
}

export function buildUI(root: HTMLElement, opts: UIOptions): UI {
  root.append(el("h1", undefined, "Демо: библиотека Music"));

  const hint = el("p", "hint", "Кликните в любом месте — браузер разрешит звук");
  root.append(hint);

  /* Трек */
  const trackCard = card(root, "Трек");
  const trackRow = el("div", "row");
  const trackButtons = new Map<string, HTMLButtonElement>();
  for (const { id, label } of opts.tracks) {
    const btn = toggle(trackRow, label, () => opts.onTrack(id));
    trackButtons.set(id, btn);
  }
  trackCard.append(trackRow);

  const rateRow = el("div", "rate");
  rateRow.append(el("span", undefined, "Темп"));
  const rateSlider = el("input");
  rateSlider.type = "range";
  rateSlider.min = String(opts.minRate);
  rateSlider.max = "1";
  rateSlider.step = "0.01";
  rateSlider.value = "1";
  rateSlider.oninput = () => opts.onRate(Number(rateSlider.value));
  rateRow.append(rateSlider);
  trackCard.append(rateRow);

  const status = el("p", "status");
  trackCard.append(status);

  /* Приглушение */
  const duckCard = card(root, "Приглушение");
  const duckRow = el("div", "row");
  const pauseBtn = toggle(duckRow, "Пауза", () => opts.onPause(!pauseBtn.classList.contains("toggle-active")));
  const adBtn = toggle(duckRow, "Реклама", () => opts.onAd(!adBtn.classList.contains("toggle-active")));
  duckCard.append(duckRow);
  duckCard.append(
    el(
      "p",
      "note",
      "Пауза приглушает «под водой» (×duckLevel + lowpass 400 Гц). Реклама выключает музыку целиком — трек возобновится сам.",
    ),
  );

  /* Питание */
  const powerCard = card(root, "Питание");
  const label = el("label", "switch");
  const powerBox = el("input");
  powerBox.type = "checkbox";
  powerBox.checked = true;
  powerBox.onchange = () => opts.onEnabled(powerBox.checked);
  label.append(powerBox, el("span", "power-text", "Музыка вкл/выкл"));
  powerCard.append(label);

  return {
    render(state: UIState): void {
      for (const [id, btn] of trackButtons) {
        btn.classList.toggle("toggle-active", state.current === id);
      }
      pauseBtn.classList.toggle("toggle-active", state.paused);
      adBtn.classList.toggle("toggle-active", state.ad);
      powerBox.checked = state.enabled;

      const what = !state.enabled ? "выключена" : state.current ? `играет: ${state.current}` : "тишина";
      const flags = [state.paused && "пауза", state.ad && "реклама"].filter(Boolean).join(" · ");
      const rateTxt = state.rate !== 1 ? ` · rate ${state.rate}` : "";
      status.textContent = `${what}${rateTxt}${flags ? ` · ${flags}` : ""}`;
    },
    dismissHint(): void {
      hint.remove();
    },
  };
}
