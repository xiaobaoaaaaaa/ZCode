import type { SettingsSectionId } from "@/lib/settingsNavigation.js";

export interface SettingsSearchOptions {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  hostPlatform?: string;
}

export interface SettingsSearchResult {
  id: string;
  section: SettingsSectionId;
  title: string;
  sectionTitle: string;
  description: string;
  /** 纯静态中英文索引；不包含任何用户配置值。 */
  searchText: string;
  titleText: string;
  sectionOnly: boolean;
}
