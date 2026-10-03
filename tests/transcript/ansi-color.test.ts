import { expect, test } from "vitest";
import {
  ansi16ToRgb,
  ansi256ToRgb,
} from "../../extensions/tools/ansi-color.ts";

test("ansi256ToRgb: 合法边界 0/15/16/231/232/255", () => {
  expect(ansi256ToRgb(0)).toStrictEqual([0, 0, 0]);
  expect(ansi256ToRgb(15)).toStrictEqual([255, 255, 255]);
  expect(ansi256ToRgb(16)).toStrictEqual([0, 0, 0]);
  expect(ansi256ToRgb(231)).toStrictEqual([255, 255, 255]);
  expect(ansi256ToRgb(232)).toStrictEqual([8, 8, 8]);
  expect(ansi256ToRgb(255)).toStrictEqual([238, 238, 238]);
});

test("ansi256ToRgb: 越界/非法输入钳制，不产生超出 0-255 的 RGB", () => {
  expect(ansi256ToRgb(-1)).toStrictEqual([0, 0, 0]);
  expect(ansi256ToRgb(256)).toStrictEqual([238, 238, 238]);
  expect(ansi256ToRgb(1000)).toStrictEqual([238, 238, 238]);
  expect(ansi256ToRgb(1.5)).toStrictEqual([128, 0, 0]);
  expect(ansi256ToRgb(Number.NaN)).toStrictEqual([0, 0, 0]);
  expect(ansi256ToRgb(Number.POSITIVE_INFINITY)).toStrictEqual([0, 0, 0]);
});

test("ansi16ToRgb: 越界回退白", () => {
  expect(ansi16ToRgb(-1)).toStrictEqual([255, 255, 255]);
  expect(ansi16ToRgb(16)).toStrictEqual([255, 255, 255]);
});
