import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slomoFilterHz, targetGain } from "../src/gain.ts";

describe("targetGain", () => {
  it("играет на громкости опции", () => {
    assert.equal(targetGain(true, false, 0.35, 0.3), 0.35);
  });

  it("даккинг умножает громкость", () => {
    assert.equal(targetGain(true, true, 0.35, 0.3), 0.105);
  });

  it("выключенная музыка — ноль, даккинг не важен", () => {
    assert.equal(targetGain(false, false, 0.35, 0.3), 0);
    assert.equal(targetGain(false, true, 0.35, 0.3), 0);
  });
});

describe("slomoFilterHz", () => {
  const minRate = 0.7;
  const openHz = 20000;
  const closedHz = 2500;

  it("при rate = 1 фильтр открыт", () => {
    assert.equal(slomoFilterHz(1, minRate, openHz, closedHz), openHz);
  });

  it("при rate = minRate приопущен до slomoHz", () => {
    assert.equal(slomoFilterHz(minRate, minRate, openHz, closedHz), closedHz);
  });

  it("между — линейно", () => {
    assert.equal(slomoFilterHz(0.85, minRate, openHz, closedHz), 11250);
  });

  it("глубже minRate не душит сильнее нижней точки", () => {
    assert.equal(slomoFilterHz(0.5, minRate, openHz, closedHz), closedHz);
  });

  it("выше единицы не открывает шире обычного", () => {
    assert.equal(slomoFilterHz(1.2, minRate, openHz, closedHz), openHz);
  });
});
