/**
 * data-import 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 */
export type { ZCodeDataImportRequest, ZCodeDataImportResult } from "@zcode/shared";

export interface DataImportOptions {
  /** 固定的初始 desktop home，不跟随副本改变。 */
  bootstrapHome: string;
  /** 当前实际使用的数据根，禁止导入正在使用的 profile。 */
  currentDataRoot: string;
}
