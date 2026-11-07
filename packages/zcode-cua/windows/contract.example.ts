/**
 * cua-windows-open 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { WindowsAutomationBackend } from "./contract.js";

export async function exampleCuaWindowsOpen(backend: WindowsAutomationBackend) {
  return backend.call({ method: "list_apps", args: {}, owner: "runtime/session/workspace" });
}
