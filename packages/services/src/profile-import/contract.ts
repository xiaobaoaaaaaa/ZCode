export interface ProfileImportPreview {
  token: string;
  source: string;
  projects: number;
  files: number;
  bytes: number;
}
export interface ProfileImportReport {
  imported: number;
  duplicates: number;
  conflicts: string[];
}
export interface PersonalProfileImportContract {
  /** Read only, replaces any prior lease; source must be explicitly selected. */
  previewProfileImport(params: { source: string }): Promise<ProfileImportPreview>;
  /** Consumes a preview lease, revalidates, copies missing workspaces exclusively. */
  confirmProfileImport(params: { token: string }): Promise<ProfileImportReport>;
}

export type ImportableAppearance = {
  locale?: "zh-CN" | "en-US";
  localePreference?: "system" | "zh-CN" | "en-US";
  desktopZoomLevel?: number;
};
export interface AppearanceImportPreview {
  token: string;
  source: string;
  settings: ImportableAppearance;
}
export interface AppearanceImportReport {
  imported: string[];
  preserved: string[];
}
export interface AppearanceImportContract {
  previewAppearanceImport(params: { source: string }): Promise<AppearanceImportPreview>;
  confirmAppearanceImport(params: { token: string }): Promise<AppearanceImportReport>;
}

export interface HistoryImportBundle {
  sourceKey: string;
  sourceSessionId: string;
  sourceProfile: string;
  sourceDatabaseHash: string;
  contentHash: string;
  title: string;
  directory: string;
  workspaceId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: Array<{ role: "user" | "assistant"; text: string; createdAt: number }>;
}
export interface HistoryImportPreview {
  token: string;
  source: string;
  sessions: Array<{ sourceKey: string; title: string; directory: string; messages: number }>;
  skipped: Array<{ sourceSessionId: string; reason: string }>;
  messages: number;
}
/** Target owns atomic ID remapping, idempotency and recoverable task/project registration. */
export interface HistoryImportReport {
  imported: number;
  duplicates: number;
  sessions: Array<{ sourceKey: string; sessionId: string; directory: string }>;
}
export interface HistoryImportContract {
  previewHistoryImport(params: {
    source: string;
    sourceClosed: true;
  }): Promise<HistoryImportPreview>;
  confirmHistoryImport(params: { token: string }): Promise<HistoryImportReport>;
}
