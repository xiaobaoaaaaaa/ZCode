/**
 * cua-windows-open 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const cuaWindowsOpenModule = {
  id: "cua-windows-open",
  requires: ["zcode-cli"],
  provides: ["cua-windows-open"],
  publicEntrypoints: ["index.js", "contract.ts"],
} as const;
