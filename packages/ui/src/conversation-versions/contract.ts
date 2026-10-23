export interface ConversationVersion {
  id: string;
  createdAt: number;
  messageCount: number;
}

/** UI only; the runtime owns durable versions and checks idle/revision admission. */
export interface ConversationVersionsContract {
  disabled: boolean;
  /** Read metadata for this session without loading message bodies. */
  load: () => Promise<ConversationVersion[]>;
  /** Resolve after persistence and projection refresh; never replay tools or undo files. */
  restore: (id: string) => Promise<void>;
}
