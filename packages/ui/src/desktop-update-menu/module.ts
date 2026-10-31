/**
 * desktop-update-menu 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const desktopUpdateMenuModule = {
  id: "desktop-update-menu",
  requires: ["shared"],
  provides: ["desktop-update-menu"],
  publicEntrypoints: ["../lib/desktopUpdateMenu.ts", "contract.ts"],
} as const;
