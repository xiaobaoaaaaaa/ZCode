import type { HistoryImportService } from "./contract.js";
/** Preview only: confirmation must follow the user's review. */
export function exampleHistoryImport(service: HistoryImportService, selectedSource: string) {
  return service.previewHistoryImport({ source: selectedSource, sourceClosed: true });
}
