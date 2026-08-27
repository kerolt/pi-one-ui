export type RenderRequest = (force: boolean) => void;
export type RenderSchedule = (run: () => void) => void;

/**
 * Coalesces render requests emitted by multiple surfaces in one turn.
 */
export class RenderScheduler {
  private readonly requestRender: RenderRequest;
  private readonly schedule: RenderSchedule;
  private scheduled = false;
  private forced = false;
  private disposed = false;

  /**
   * Creates a scheduler for a concrete render callback.
   *
   * @param requestRender Callback that renders the active TUI.
   * @param schedule Microtask scheduler used to coalesce requests.
   */
  constructor(
    requestRender: RenderRequest,
    schedule: RenderSchedule = queueMicrotask,
  ) {
    this.requestRender = requestRender;
    this.schedule = schedule;
  }

  /**
   * Queues one render and preserves forced redraw priority.
   *
   * @param force Whether the pending render must be a full redraw.
   */
  request(force = false): void {
    if (this.disposed) return;
    this.forced ||= force;
    if (this.scheduled) return;

    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      if (this.disposed) return;
      const forced = this.forced;
      this.forced = false;
      this.requestRender(forced);
    });
  }

  /**
   * Cancels future callbacks and makes later requests no-ops.
   */
  dispose(): void {
    this.disposed = true;
    this.scheduled = false;
    this.forced = false;
  }
}
