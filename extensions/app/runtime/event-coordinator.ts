import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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
export type RuntimeEventHandler = (
  event: unknown,
  ctx: ExtensionContext,
) => void | Promise<void>;

export type EventRegistrar = {
  on(event: RuntimeEventName, handler: RuntimeEventHandler): void;
};

/**
 * Provides the central host event seam used while legacy listeners migrate.
 */
export class EventCoordinator {
  private readonly registrar: EventRegistrar;
  private readonly handlers = new Map<
    RuntimeEventName,
    Set<RuntimeEventHandler>
  >();
  private installed = false;

  /**
   * Creates a coordinator backed by the host event registrar.
   *
   * @param registrar Host adapter used to install event listeners.
   */
  constructor(registrar: EventRegistrar) {
    this.registrar = registrar;
  }

  /**
   * Registers a handler for one coordinated runtime event.
   *
   * @returns A function that removes the handler.
   */
  on(event: RuntimeEventName, handler: RuntimeEventHandler): () => void {
    const handlers = this.handlers.get(event) ?? new Set<RuntimeEventHandler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  /**
   * Installs one host listener per coordinated event.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    for (const event of RUNTIME_EVENTS) {
      this.registrar.on(event, (payload, ctx) => {
        let pending: Promise<void> | undefined;
        for (const handler of this.handlers.get(event) ?? []) {
          if (pending) {
            pending = pending.then(() => handler(payload, ctx)).then(() => {});
            continue;
          }
          const result = handler(payload, ctx);
          if (result instanceof Promise) pending = result.then(() => {});
        }
        return pending;
      });
    }
  }
}
