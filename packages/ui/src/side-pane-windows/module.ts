/**
 * side-pane-windows 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const sidePaneWindowsModule = {
  id: "side-pane-windows",
  requires: ["shared", "ui"],
  provides: ["side-pane-windows"],
  publicEntrypoints: ["index.ts", "contract.ts", "portal.ts"],
} as const;
