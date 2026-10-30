import en from "@/i18n/locales/en-US.js";
import zh from "@/i18n/locales/zh-CN.js";
import {
  createSettingsPageConfig,
  isSettingsSectionAvailable,
} from "@/settings/settingsPageConfig.js";
import type { SettingsSectionId } from "@/lib/settingsNavigation.js";
import type { SettingsSearchOptions, SettingsSearchResult } from "./types.js";

// 与 SettingsRow.searchId 同源的稳定翻译键，不扫描/挂载隐藏页面，也不索引用户数据。
const SETTING_ROWS: readonly (readonly [SettingsSectionId, string, string])[] = [
  ["archives", "settings.taskAutoArchive", "settings.taskAutoArchiveDescription"],
  ["archives", "settings.taskAutoArchiveDays", "settings.taskAutoArchiveDaysDescription"],
  ["general", "settings.locale", "settings.localeDescription"],
  ["general", "settings.interfaceMode", "settings.interfaceMode.description"],
  ["general", "settings.terminalProfile", "settings.terminalProfileDescription"],
  ["general", "settings.terminalFontFamily", "settings.terminalFontFamilyDescription"],
  ["general", "settings.integratedTerminalShell", "settings.integratedTerminalShellDescription"],
  ["general", "settings.toolSearch", "settings.toolSearchDescription"],
  ["general", "settings.nativeSearchEnhancements", "settings.nativeSearchEnhancementsDescription"],
  ["general", "settings.httpProxy", "settings.httpProxyDescription"],
  ["general", "settings.httpProxyNoProxy", "settings.httpProxyNoProxyDescription"],
  ["general", "settings.httpProxyCaCertPath", "settings.httpProxyCaCertPathDescription"],
  [
    "general",
    "settings.desktopChromiumHardwareAcceleration",
    "settings.desktopChromiumHardwareAccelerationDescription",
  ],
  ["general", "settings.receivePreviewUpdates", "settings.receivePreviewUpdatesDescription"],
  [
    "general",
    "settings.autoDownloadAndInstallUpdates",
    "settings.autoDownloadAndInstallUpdatesDescription",
  ],
  ["general", "settings.notification", "settings.notificationDescription"],
  ["general", "settings.notificationSound", "settings.notificationSoundDescription"],
  ["general", "settings.closeToTrayOnWindows", "settings.closeToTrayOnWindowsDescription"],
  ["general", "settings.keepAwakeWhileRunning", "settings.keepAwakeWhileRunningDescription"],
  ["general", "settings.zcodeInteractionBehavior", "settings.zcodeInteractionBehaviorDescription"],
  [
    "general",
    "settings.askUserQuestionAutoResolution",
    "settings.askUserQuestionAutoResolutionDescription",
  ],
  ["general", "settings.modelIoFullRetention", "settings.modelIoFullRetentionDescription"],
  [
    "general",
    "settings.messageStreamShowReasoning",
    "settings.messageStreamShowReasoningDescription",
  ],
  ["general", "settings.messageStreamShowTodos", "settings.messageStreamShowTodosDescription"],
  ["general", "settings.toolGroupingExplore", "settings.toolGroupingExploreDescription"],
  ["general", "settings.toolGroupingTerminal", "settings.toolGroupingTerminalDescription"],
  ["general", "settings.toolGroupingChanges", "settings.toolGroupingChangesDescription"],
  ["general", "settings.dataBaseDir", "settings.dataBaseDirDescription"],
  ["general", "settings.onboarding", "settings.onboardingDescription"],
  ["appearance", "settings.themeMode", "settings.themeModeDescription"],
  ["appearance", "settings.uiFontSize", "settings.uiFontSizeDescription"],
  ["appearance", "settings.lightTheme", "settings.lightThemeDescription"],
  ["appearance", "settings.darkTheme", "settings.darkThemeDescription"],
  ["appearance", "settings.showLineNumbers", "settings.showLineNumbersDescription"],
  ["appearance", "settings.wrapLongLines", "settings.wrapLongLinesDescription"],
  ["appearance", "settings.fontSize", "settings.fontSizeDescription"],
];

const SECTION_KEYWORDS: Partial<Record<SettingsSectionId, string>> = {
  general:
    "语言 language 通知 notification 网络 network 代理 proxy 终端 terminal 主动建议 proactive suggestions 工作流 workflow",
  appearance: "字体 font 主题 theme 颜色 color 外观 appearance",
  modelProvider: "模型 model provider 供应商 api key 密钥 endpoint base url reasoning 思考",
  memory: "记忆 memory 自动记忆 instructions",
  subagents: "子代理 智能体 agent subagent 模型 model",
  plugin: "插件 商店 市场 plugin marketplace",
  mcp: "MCP server 工具 服务 连接",
  skill: "技能 skill",
  commands: "命令 slash command",
  hooks: "钩子 hooks",
  automations: "定时 自动化 计划 schedule automation cron",
  browser: "浏览器 browser chrome 权限 permission",
  remoteDevices: "远程 设备 remote ssh wsl connection 连接",
  computerUse: "电脑控制 computer use 桌面 desktop",
  shortcuts: "快捷键 keyboard shortcuts 按键 热键",
  workspaceFileSearch: "文件 搜索 忽略 file search ignore zcodeignore",
  usage: "用量 统计 usage cost token 费用",
  archives: "归档 archive 自动 清理",
};
const ITEM_KEYWORDS: Record<string, string> = {
  "settings.uiFontSize": "字体 字号 font text size",
  "settings.fontSize": "代码字体 code font size",
};
const DESKTOP_ROWS = new Set([
  "settings.desktopChromiumHardwareAcceleration",
  "settings.receivePreviewUpdates",
  "settings.autoDownloadAndInstallUpdates",
  "settings.keepAwakeWhileRunning",
]);
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();

export function createSettingsSearchIndex(
  options: SettingsSearchOptions,
  locale: string,
): SettingsSearchResult[] {
  const messages = locale.startsWith("zh") ? zh : en;
  const sections = createSettingsPageConfig(options).settingsSections.filter((section) =>
    isSettingsSectionAvailable(section.id, Boolean(options.isDesktop)),
  );
  const make = (
    section: (typeof sections)[number],
    id: string,
    titleId: string,
    descriptionId: string,
    sectionOnly: boolean,
  ): SettingsSearchResult => ({
    id,
    section: section.id,
    title: messages[titleId] ?? titleId,
    sectionTitle: messages[section.titleId] ?? section.titleId,
    description: messages[descriptionId] ?? "",
    titleText: normalize([zh[titleId], en[titleId], ITEM_KEYWORDS[titleId]].join(" ")),
    searchText: normalize(
      [
        zh[titleId],
        en[titleId],
        ITEM_KEYWORDS[titleId],
        zh[descriptionId],
        en[descriptionId],
        zh[section.titleId],
        en[section.titleId],
        sectionOnly ? SECTION_KEYWORDS[section.id] : "",
      ].join(" "),
    ),
    sectionOnly,
  });
  return sections.flatMap((section) => [
    make(section, `section:${section.id}`, section.titleId, "", true),
    ...SETTING_ROWS.filter(([id, titleId]) => {
      if (id !== section.id) return false;
      if (DESKTOP_ROWS.has(titleId) && !options.isDesktop) return false;
      if (titleId === "settings.integratedTerminalShell" && options.hostPlatform !== "win32")
        return false;
      if (
        titleId === "settings.closeToTrayOnWindows" &&
        (!options.isDesktop || options.isMacDesktop)
      )
        return false;
      return true;
    }).map(([, titleId, descriptionId]) => make(section, titleId, titleId, descriptionId, false)),
  ]);
}

export function searchSettings(
  index: readonly SettingsSearchResult[],
  query: string,
): SettingsSearchResult[] {
  const normalized = normalize(query);
  if (!normalized) return index.filter((row) => row.sectionOnly);
  const tokens = normalized.split(/\s+/u);
  const score = (row: SettingsSearchResult) =>
    normalize(row.title) === normalized
      ? 3
      : tokens.every((token) => row.titleText.includes(token))
        ? 2
        : 1;
  return index
    .filter((row) => tokens.every((token) => row.searchText.includes(token)))
    .toSorted((a, b) => score(b) - score(a));
}
