/**
 * cua-windows-open 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 */
export interface WindowsAutomationBackend {
  /** 串行请求，不重试；取消后的副作用视作可能已发生。 */
  call(
    request: { method: string; args: Record<string, unknown>; owner: string },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  /** 终止确切子进程并释放 OS mutex；幂等终态。 */
  dispose(): Promise<void>;
}
