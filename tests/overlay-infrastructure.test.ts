import assert from "node:assert/strict";
import test from "node:test";
import { InputRouter } from "../extensions/app/overlay/input-router.ts";
import { OverlayManager } from "../extensions/app/overlay/overlay-manager.ts";

test("OverlayManager balances nested overlay tasks", async () => {
  const manager = new OverlayManager();
  assert.equal(manager.hasActive(), false);

  const result = await manager.run(async () => {
    assert.equal(manager.depth(), 1);
    return manager.run(async () => {
      assert.equal(manager.depth(), 2);
      return "closed";
    });
  });

  assert.equal(result, "closed");
  assert.equal(manager.depth(), 0);
  assert.equal(manager.hasActive(), false);
});

test("OverlayManager balances active state when an overlay fails", async () => {
  const manager = new OverlayManager();
  await assert.rejects(
    manager.run(async () => {
      assert.equal(manager.hasActive(), true);
      throw new Error("overlay failed");
    }),
    /overlay failed/,
  );
  assert.equal(manager.depth(), 0);
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

  assert.deepEqual(router.dispatch("input"), { consume: true });
  assert.deepEqual(calls, ["high"]);
  removeHigh();
  assert.deepEqual(router.dispatch("input"), { consume: true });
  assert.deepEqual(calls, ["high", "same-priority-after"]);
});
