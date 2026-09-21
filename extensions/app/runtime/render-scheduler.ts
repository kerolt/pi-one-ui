export type RenderRequest = (force: boolean) => void;
export type RenderSchedule = (run: () => void) => void;

/** 一个运行时对应一个 Pi TUI；组件提供同一界面的刷新入口。 */
export class RenderScheduler {
  private readonly renderers = new Map<object, RenderRequest>();
  private generation = 0;
  private scheduled = false;
  private forced = false;
  private disposed = false;

  constructor(
    private readonly requestRender?: RenderRequest,
    private readonly schedule: RenderSchedule = queueMicrotask,
  ) {}

  register(owner: object, render: RenderRequest | undefined): void {
    if (render) {
      this.renderers.set(owner, render);
    } else {
      this.renderers.delete(owner);
    }
  }

  request(force = false): void {
    if (this.disposed) {
      return;
    }
    this.forced ||= force;
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    const generation = this.generation;
    this.schedule(() => {
      if (this.disposed || generation !== this.generation) {
        return;
      }
      this.scheduled = false;
      const forced = this.forced;
      this.forced = false;
      const render = this.requestRender ?? this.renderers.values().next().value;
      render?.(forced);
    });
  }

  /** 清除当前 session 的入口与请求，旧回调不能消费新 session 的请求。 */
  reset(): void {
    this.generation += 1;
    this.scheduled = false;
    this.forced = false;
    this.disposed = false;
    this.renderers.clear();
  }

  dispose(): void {
    this.reset();
    this.disposed = true;
  }
}
