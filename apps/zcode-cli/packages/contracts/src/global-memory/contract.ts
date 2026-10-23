/** The local profile owns this snapshot; memory is background data, not instructions. */
export interface GlobalMemorySnapshot {
  content: string;
  enabled: boolean;
  extractionEnabled: boolean;
  generation: number;
  disabledSessionIds: string[];
}

export interface GlobalMemoryOperationOptions {
  signal?: AbortSignal;
}

export interface GlobalMemoryPort {
  /** Fresh read. Invalid configuration, unsafe paths and active writers fail closed. */
  read(options?: GlobalMemoryOperationOptions): Promise<GlobalMemorySnapshot>;
  /** Automatic extraction commit. False means disabled or stale; no retry with new generation. */
  write(
    input: { content: string; expectedGeneration: number; sessionId?: string },
    options?: GlobalMemoryOperationOptions,
  ): Promise<boolean>;
}
