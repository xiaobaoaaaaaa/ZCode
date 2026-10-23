import type { useZCodeTaskService } from "@/hooks/useZCodeTaskService.js";
/** The local task-service hook is the port; this module never imports a service implementation. */
export type HistoryImportService = Pick<
  ReturnType<typeof useZCodeTaskService>,
  "previewHistoryImport" | "confirmHistoryImport"
>;
export type HistoryImportPreview = Awaited<
  ReturnType<HistoryImportService["previewHistoryImport"]>
>;
export type HistoryImportReport = Awaited<ReturnType<HistoryImportService["confirmHistoryImport"]>>;
