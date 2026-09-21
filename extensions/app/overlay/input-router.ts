import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export type InputRouteResult = { consume?: boolean; data?: string } | undefined;
export type InputRoute = (data: string) => InputRouteResult;
type InputHost = Pick<ExtensionUIContext, "onTerminalInput">;
type RegisteredRoute = { priority: number; order: number; route: InputRoute };
type HostRegistration = { remove: () => void; leases: Set<object> };

/** 输入路由与 Pi listener 共同注册、共同释放。 */
export class InputRouter {
  private nextOrder = 0;
  private readonly routes: RegisteredRoute[] = [];
  private readonly hosts = new Map<
    InputHost["onTerminalInput"],
    HostRegistration
  >();

  register(route: InputRoute, priority = 0): () => void {
    const entry = { priority, order: this.nextOrder++, route };
    this.routes.push(entry);
    this.routes.sort(
      (left, right) =>
        right.priority - left.priority || left.order - right.order,
    );
    return () => {
      const index = this.routes.indexOf(entry);
      if (index >= 0) {
        this.routes.splice(index, 1);
      }
    };
  }

  bind(host: InputHost, route: InputRoute, priority = 0): () => void {
    const removeRoute = this.register(route, priority);
    const key = host.onTerminalInput;
    let registration = this.hosts.get(key);
    try {
      if (!registration) {
        registration = {
          remove: host.onTerminalInput((data) => this.dispatch(data)),
          leases: new Set(),
        };
        this.hosts.set(key, registration);
      }
    } catch (error) {
      removeRoute();
      throw error;
    }
    const current = registration;
    const token = {};
    current.leases.add(token);
    return () => {
      removeRoute();
      if (
        !current.leases.delete(token) ||
        current.leases.size > 0 ||
        this.hosts.get(key) !== current
      ) {
        return;
      }
      this.hosts.delete(key);
      current.remove();
    };
  }

  dispatch(data: string): InputRouteResult {
    for (const entry of [...this.routes]) {
      const result = entry.route(data);
      if (result?.consume) {
        return result;
      }
    }
    return undefined;
  }

  clear(): void {
    this.routes.length = 0;
    const registrations = [...this.hosts.values()];
    this.hosts.clear();
    for (const registration of registrations) {
      registration.leases.clear();
      registration.remove();
    }
  }
}

export const inputRouter = new InputRouter();
