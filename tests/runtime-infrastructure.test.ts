import assert from "node:assert/strict";
import test from "node:test";
import {
  EventCoordinator,
  RUNTIME_EVENTS,
} from "../extensions/app/runtime/event-coordinator.ts";
import { RenderScheduler } from "../extensions/app/runtime/render-scheduler.ts";
import { RuntimeStateStore } from "../extensions/app/runtime/runtime-state.ts";
import { SurfaceRegistry } from "../extensions/app/ownership/surface-registry.ts";

test("EventCoordinator installs each runtime event once and dispatches in order", async () => {
  const registrations: Array<{
    event: string;
    handler: (event: unknown, ctx: never) => Promise<void>;
  }> = [];
  const coordinator = new EventCoordinator({
    on(event, handler) {
      registrations.push({ event, handler: handler as never });
    },
  });
  const calls: string[] = [];
  coordinator.on("session_start", async () => {
    calls.push("first");
  });
  coordinator.on("session_start", async () => {
    calls.push("second");
  });
  coordinator.install();

  assert.deepEqual(
    registrations.map(({ event }) => event),
    [...RUNTIME_EVENTS],
  );
  const sessionStart = registrations.find(
    ({ event }) => event === "session_start",
  );
  assert.ok(sessionStart);
  await sessionStart.handler({}, {} as never);
  assert.deepEqual(calls, ["first", "second"]);
});

test("RenderScheduler coalesces requests and retains forced redraw priority", async () => {
  const queued: Array<() => void> = [];
  const renders: boolean[] = [];
  const scheduler = new RenderScheduler(
    (force) => renders.push(force),
    (run) => queued.push(run),
  );

  scheduler.request();
  scheduler.request(true);
  scheduler.request();
  assert.equal(queued.length, 1);
  assert.deepEqual(renders, []);

  queued.shift()?.();
  assert.deepEqual(renders, [true]);
  scheduler.dispose();
  scheduler.request(true);
  assert.equal(queued.length, 0);
});

test("RuntimeStateStore rejects stale shutdown and notifies session transitions", () => {
  const store = new RuntimeStateStore();
  const states: string[] = [];
  store.subscribe((state) =>
    states.push(`${state.phase}:${state.generation}:${state.mode ?? ""}`),
  );

  const first = store.start("tui");
  const second = store.start("tui");
  store.shutdown(first);
  assert.equal(store.isCurrent(second), true);
  store.shutdown(second);

  assert.deepEqual(states, ["active:1:tui", "active:2:tui", "idle:2:"]);
});

test("SurfaceRegistry permits one token per surface and safe release", () => {
  const registry = new SurfaceRegistry();
  const first = {};
  const second = {};
  const release = registry.claim("footer", first);

  assert.equal(registry.ownerOf("footer"), "footer");
  assert.throws(() => registry.claim("footer", second), /already owned/);
  release();
  release();
  assert.equal(registry.isClaimed("footer"), false);

  const releaseSecond = registry.claim("footer", second);
  assert.equal(registry.isClaimed("footer"), true);
  releaseSecond();
});
