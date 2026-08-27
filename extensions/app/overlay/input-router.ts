export type InputRouteResult = { consume?: boolean; data?: string } | undefined;
export type InputRoute = (data: string) => InputRouteResult;

type RegisteredRoute = {
  priority: number;
  order: number;
  route: InputRoute;
};

/**
 * Routes raw terminal input by descending priority and stops at a consumer.
 */
export class InputRouter {
  private nextOrder = 0;
  private readonly routes: RegisteredRoute[] = [];

  /**
   * Registers an input route.
   *
   * @param route Handler that may consume one input packet.
   * @param priority Higher-priority routes receive input first.
   * @returns A function that removes the route.
   */
  register(route: InputRoute, priority = 0): () => void {
    const entry: RegisteredRoute = {
      priority,
      order: this.nextOrder++,
      route,
    };
    this.routes.push(entry);
    this.routes.sort(
      (left, right) =>
        right.priority - left.priority || left.order - right.order,
    );
    return () => {
      const index = this.routes.indexOf(entry);
      if (index >= 0) this.routes.splice(index, 1);
    };
  }

  /**
   * Routes one input packet until a registered handler consumes it.
   *
   * @param data Raw terminal input packet.
   * @returns The consuming route result, if any.
   */
  dispatch(data: string): InputRouteResult {
    for (const entry of [...this.routes]) {
      const result = entry.route(data);
      if (result?.consume) return result;
    }
    return undefined;
  }

  /**
   * Removes all registered routes, normally during runtime teardown.
   */
  clear(): void {
    this.routes.length = 0;
  }
}

export const inputRouter = new InputRouter();
