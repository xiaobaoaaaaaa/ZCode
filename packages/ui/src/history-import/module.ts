export const historyImportModule = {
  id: "history-import-ui",
  requires: ["ui"],
  provides: ["history-import-ui"],
  publicEntrypoints: ["index.tsx", "contract.ts"],
} as const;
