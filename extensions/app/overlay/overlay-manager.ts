export type OverlayTask<T> = () => Promise<T>;

/**
 * Tracks plugin-owned overlay activity across settings and context dialogs.
 */
export class OverlayManager {
  private activeCount = 0;

  /**
   * Runs one asynchronous overlay task and balances its active count.
   *
   * @param task Function that opens and waits for the overlay.
   * @returns The value produced when the overlay closes.
   */
  async run<T>(task: OverlayTask<T>): Promise<T> {
    this.activeCount += 1;
    try {
      return await task();
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  /**
   * Reports whether at least one plugin-owned overlay is active.
   */
  hasActive(): boolean {
    return this.activeCount > 0;
  }

  /**
   * Returns the current plugin-owned overlay depth.
   */
  depth(): number {
    return this.activeCount;
  }
}

export const overlayManager = new OverlayManager();
