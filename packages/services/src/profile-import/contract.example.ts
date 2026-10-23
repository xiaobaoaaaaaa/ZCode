import type { PersonalProfileImportContract } from "./contract.js";
/** Confirmation must be a separate user action after displaying the preview. */
export async function previewSelectedProfile(
  service: PersonalProfileImportContract,
  source: string,
) {
  return service.previewProfileImport({ source });
}
