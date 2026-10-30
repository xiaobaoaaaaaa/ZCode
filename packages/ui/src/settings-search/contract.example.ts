import { createSettingsSearchIndex, searchSettings } from "./contract.js";

export function findFontSettings() {
  return searchSettings(createSettingsSearchIndex({}, "zh-CN"), "字体");
}
