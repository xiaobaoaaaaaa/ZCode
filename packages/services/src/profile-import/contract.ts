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
