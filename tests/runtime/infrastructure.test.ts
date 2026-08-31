import { expect, test } from "vitest";
import { LayoutRegistry } from "../../extensions/app/ownership/layout-registry.ts";
import {
  EventCoordinator,
  RUNTIME_EVENTS,
} from "../../extensions/app/runtime/event-coordinator.ts";
import { RenderScheduler } from "../../extensions/app/runtime/render-scheduler.ts";
import { RuntimeStateStore } from "../../extensions/app/runtime/runtime-state.ts";

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

  expect(registrations.map(({ event }) => event)).toStrictEqual([
    ...RUNTIME_EVENTS,
  ]);
  const sessionStart = registrations.find(
    ({ event }) => event === "session_start",
  );
  expect(sessionStart).toBeTruthy();
  await sessionStart.handler({}, {} as never);
  expect(calls).toStrictEqual(["first", "second"]);
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
  expect(queued.length).toBe(1);
  expect(renders).toStrictEqual([]);

  queued.shift()?.();
  expect(renders).toStrictEqual([true]);
  scheduler.dispose();
  scheduler.request(true);
  expect(queued.length).toBe(0);
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
  expect(store.isCurrent(second)).toBe(true);
  store.shutdown(second);

  expect(states).toStrictEqual(["active:1:tui", "active:2:tui", "idle:2:"]);
});

test("LayoutRegistry permits one token per layout and safe release", () => {
  const registry = new LayoutRegistry();
  const first = {};
  const second = {};
  const release = registry.claim("footer", first);

  expect(registry.ownerOf("footer")).toBe("footer");
  expect(() => registry.claim("footer", second)).toThrow(/already owned/);
  release();
  release();
  expect(registry.isClaimed("footer")).toBe(false);

  const releaseSecond = registry.claim("footer", second);
  expect(registry.isClaimed("footer")).toBe(true);
  releaseSecond();
});
