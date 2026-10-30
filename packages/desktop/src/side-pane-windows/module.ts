/**
 * side-pane-window-host 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const sidePaneWindowHostModule = {
  id: "side-pane-window-host",
  requires: ["shared"],
  provides: ["side-pane-window-host"],
  publicEntrypoints: ["index.ts", "contract.ts", "../renderer/src/side-pane-windows/renderer.ts"],
} as const;
