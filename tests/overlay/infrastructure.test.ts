import { expect, test } from "vitest";
import { InputRouter } from "../../extensions/app/overlay/input-router.ts";
import { OverlayManager } from "../../extensions/app/overlay/overlay-manager.ts";

test("OverlayManager balances nested overlay tasks", async () => {
  const manager = new OverlayManager();
  expect(manager.hasActive()).toBe(false);

  const result = await manager.run(async () => {
    expect(manager.depth()).toBe(1);
    return manager.run(async () => {
      expect(manager.depth()).toBe(2);
      return "closed";
    });
  });

  expect(result).toBe("closed");
  expect(manager.depth()).toBe(0);
  expect(manager.hasActive()).toBe(false);
});

test("OverlayManager balances active state when an overlay fails", async () => {
  const manager = new OverlayManager();
  await expect(
    manager.run(async () => {
      expect(manager.hasActive()).toBe(true);
      throw new Error("overlay failed");
    }),
  ).rejects.toThrow(/overlay failed/);
  expect(manager.depth()).toBe(0);
});

test("InputRouter dispatches by priority and registration order", () => {
  const router = new InputRouter();
  const calls: string[] = [];
  router.register(() => {
    calls.push("low");
    return undefined;
  }, 1);
  const removeHigh = router.register(() => {
    calls.push("high");
    return { consume: true };
  }, 10);
  router.register(() => {
    calls.push("same-priority-after");
    return { consume: true };
  }, 10);

  expect(router.dispatch("input")).toStrictEqual({ consume: true });
  expect(calls).toStrictEqual(["high"]);
  removeHigh();
  expect(router.dispatch("input")).toStrictEqual({ consume: true });
  expect(calls).toStrictEqual(["high", "same-priority-after"]);
});
