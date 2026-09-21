import { expect, test } from "vitest";
import {
  EventCoordinator,
  RUNTIME_EVENTS,
} from "../../extensions/app/runtime/event-coordinator.ts";
import { RenderScheduler } from "../../extensions/app/runtime/render-scheduler.ts";
import { SessionLifecycle } from "../../extensions/app/runtime/session-lifecycle.ts";

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

test("SessionLifecycle invalidates callbacks when a new session starts", async () => {
  const lifecycle = new SessionLifecycle();
  const calls: number[] = [];
  const first = lifecycle.start();
  lifecycle.queueMicrotask(() => calls.push(first));
  const second = lifecycle.start();
  lifecycle.queueMicrotask(() => calls.push(second));
  await Promise.resolve();
  expect(calls).toEqual([second]);
  expect(lifecycle.isCurrent(first)).toBe(false);
  lifecycle.shutdown();
  lifecycle.shutdown();
  expect(lifecycle.isCurrent(second)).toBe(false);
});

test("RenderScheduler coalesces component requests and rejects stale session callbacks", async () => {
  const scheduler = new RenderScheduler();
  const renders: boolean[] = [];
  const editor = {};
  const footer = {};
  scheduler.register(editor, (force) => renders.push(force));
  scheduler.request();
  scheduler.reset();
  scheduler.register(footer, (force) => renders.push(force));
  scheduler.request();
  scheduler.request(true);
  await Promise.resolve();
  expect(renders).toEqual([true]);
  scheduler.register(footer, undefined);
  scheduler.request();
  await Promise.resolve();
  expect(renders).toEqual([true]);
  scheduler.dispose();
});
