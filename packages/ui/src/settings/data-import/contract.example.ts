/**
 * data-import-ui 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { ZCodeDataImportRequest } from "./contract.js";
export const exampleDataImportRequest: ZCodeDataImportRequest = {
  sourceDirectory: "/backups/.zcode",
  destinationParent: "/data/profiles",
};
