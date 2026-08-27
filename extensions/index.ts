import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTuiRuntime } from "./app/runtime/tui-runtime.ts";

export default function (pi: ExtensionAPI): void {
  createTuiRuntime(pi).install();
}
