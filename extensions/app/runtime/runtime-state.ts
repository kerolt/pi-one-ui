export type RuntimePhase = "idle" | "active";

export type RuntimeState = Readonly<{
  phase: RuntimePhase;
  generation: number;
  mode?: string;
}>;

export type RuntimeStateListener = (state: RuntimeState) => void;

/**
 * Stores session-level runtime state while Pi keeps ownership of context data.
 */
export class RuntimeStateStore {
  private currentState: RuntimeState = { phase: "idle", generation: 0 };
  private readonly listeners = new Set<RuntimeStateListener>();

  /**
   * Returns the latest immutable runtime state snapshot.
   */
  snapshot(): RuntimeState {
    return this.currentState;
  }

  /**
   * Starts a new runtime generation.
   *
   * @returns The generation token owned by the new session.
   */
  start(mode?: string): number {
    const generation = this.currentState.generation + 1;
    this.currentState = { phase: "active", generation, mode };
    this.notify();
    return generation;
  }

  /**
   * Stops the current generation unless a newer generation is active.
   *
   * @param generation Optional token used to reject stale shutdown callbacks.
   */
  shutdown(generation?: number): void {
    if (
      generation !== undefined &&
      generation !== this.currentState.generation
    ) {
      return;
    }
    this.currentState = {
      phase: "idle",
      generation: this.currentState.generation,
    };
    this.notify();
  }

  /**
   * Reports whether a generation token still owns the active runtime.
   */
  isCurrent(generation: number): boolean {
    return (
      this.currentState.phase === "active" &&
      this.currentState.generation === generation
    );
  }

  /**
   * Subscribes to runtime state transitions.
   *
   * @returns A function that removes the listener.
   */
  subscribe(listener: RuntimeStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notifies listeners using the current state snapshot.
   */
  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
