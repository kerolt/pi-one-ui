import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";

export const RUNTIME_EVENTS = [
  "session_start",
  "session_shutdown",
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
  "model_select",
  "thinking_level_select",
  "session_info_changed",
  "session_compact",
  "session_tree",
] as const;
export type RuntimeEventName = (typeof RUNTIME_EVENTS)[number];
type RuntimeEvent<K extends RuntimeEventName> = Extract<
  ExtensionEvent,
  { type: K }
>;
type MessageReplacement = { message: MessageEndEvent["message"] };
export type RuntimeEventHandler<K extends RuntimeEventName = RuntimeEventName> =
  (
    event: RuntimeEvent<K>,
    ctx: ExtensionContext,
  ) => void | MessageReplacement | Promise<void | MessageReplacement>;
export type EventRegistrar = {
  on(event: RuntimeEventName, handler: RuntimeEventHandler): void;
};

/** 共享事件保留注册顺序、同步执行和 message_end 的替换语义。 */
export class EventCoordinator {
  private readonly handlers = new Map<
    RuntimeEventName,
    Set<RuntimeEventHandler>
  >();
  private installed = false;

  constructor(private readonly registrar: EventRegistrar) {}

  on<K extends RuntimeEventName>(
    event: K,
    handler: RuntimeEventHandler<K>,
  ): () => void {
    const handlers = this.handlers.get(event) ?? new Set<RuntimeEventHandler>();
    const registered: RuntimeEventHandler = (payload, ctx) =>
      handler(payload as RuntimeEvent<K>, ctx);
    handlers.add(registered);
    this.handlers.set(event, handlers);
    return () => {
      handlers.delete(registered);
    };
  }

  /** 专用 hook 直接使用 Pi；共享生命周期统一经过本协调器。 */
  coordinate(pi: ExtensionAPI): ExtensionAPI {
    const on = ((event: string, handler: RuntimeEventHandler) => {
      if ((RUNTIME_EVENTS as readonly string[]).includes(event)) {
        return this.on(event as RuntimeEventName, handler);
      }
      return pi.on(event as never, handler as never);
    }) as ExtensionAPI["on"];
    return new Proxy(pi, {
      get(target, property, receiver) {
        return property === "on" ? on : Reflect.get(target, property, receiver);
      },
    });
  }

  install(): void {
    if (this.installed) {
      return;
    }
    this.installed = true;
    for (const event of RUNTIME_EVENTS) {
      this.registrar.on(event, (payload, ctx) =>
        this.dispatch(event, payload, ctx),
      );
    }
  }

  dispatch<K extends RuntimeEventName>(
    event: K,
    payload: RuntimeEvent<K>,
    ctx: ExtensionContext,
  ): void | MessageReplacement | Promise<void | MessageReplacement>;
  dispatch(
    event: RuntimeEventName,
    payload: RuntimeEvent<RuntimeEventName>,
    ctx: ExtensionContext,
  ): void | MessageReplacement | Promise<void | MessageReplacement> {
    let replacement: MessageReplacement | undefined;
    let pending: Promise<void> | undefined;
    const accept = (result: void | MessageReplacement): void => {
      if (!result) {
        return;
      }
      if (
        payload.type !== "message_end" ||
        result.message.role !== payload.message.role
      ) {
        throw new TypeError(
          "Only message_end may replace a message, with the same role",
        );
      }
      replacement = result;
      payload.message = result.message;
    };
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      if (pending) {
        pending = pending.then(() => handler(payload, ctx)).then(accept);
      } else {
        const result = handler(payload, ctx);
        if (result instanceof Promise) {
          pending = result.then(accept);
        } else {
          accept(result);
        }
      }
    }
    return pending ? pending.then(() => replacement) : replacement;
  }
}
