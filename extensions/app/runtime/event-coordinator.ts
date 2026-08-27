import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const RUNTIME_EVENTS = ["session_start", "session_shutdown"] as const;

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
    for (const event of RUNTIME_EVENTS) {
      this.registrar.on(event, async (payload, ctx) => {
        for (const handler of this.handlers.get(event) ?? [])
          await handler(payload, ctx);
      });
    }
  }
}
