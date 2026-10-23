/**
 * global-memory-port 模块清单（architecture-governance managed 模块）。
 * 层：contract。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const globalMemoryPortModule = {
  id: "global-memory-port",
  requires: [],
  provides: ["global-memory-port"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
