import type { CodexAccount } from "@zcode/services";
export type { CodexAccount, CodexDeviceLogin } from "@zcode/services";
export interface CodexAccountsPanelProps {
  /** The panel reads account projections through the active Host hook. */
  className?: string;
}
export interface CodexAccountCardProps {
  account: CodexAccount;
  busy: boolean;
  synced: boolean;
  onRefresh: () => void;
  onSync: () => void;
  onRelogin: () => void;
  onRemove: () => void;
}
export const codexSubscriptionMessagesEn = {
  "codex.title": "ChatGPT / Codex",
  "codex.accountsGroup": "Subscription accounts",
  "codex.description":
    "Sign in with ChatGPT. Add an account’s models, then switch accounts manually in the model picker.",
  "codex.login": "Add account",
  "codex.relogin": "Sign in again",
  "codex.remove": "Sign out",
  "codex.refresh": "Refresh models and usage",
  "codex.connect": "Sync models",
  "codex.connected": "Synced",
  "codex.code": "Enter this code on the authorization page:",
  "codex.open": "Open authorization page",
  "codex.cancel": "Cancel login",
  "codex.waiting": "Waiting for authorization…",
  "codex.empty": "No ChatGPT accounts added.",
  "codex.window": "{hours}h remaining",
  "codex.reset": "Resets {time}",
  "codex.unknown": "Usage unavailable",
  "codex.stale": "Usage may be out of date. Refresh to retry.",
  "codex.required": "Sign in again to use this account.",
  "codex.error": "The operation failed. Please try again.",
  "codex.syncError": "Could not sync models. Please try again; your account is still signed in.",
  "codex.credits": "Credits: {value}",
  "codex.unlimited": "Unlimited credits",
  "codex.quota": "Usage",
  "codex.weekly": "Weekly remaining",
  "codex.availableModels": "Available models",
  "codex.noModels": "No models found. Refresh to retry.",
  "codex.more": "Account actions",
};
export const codexSubscriptionMessagesZh = {
  "codex.title": "ChatGPT / Codex",
  "codex.accountsGroup": "订阅账号",
  "codex.description": "使用 ChatGPT 登录。添加账号模型后，可在模型选择器中手动切换账号。",
  "codex.login": "添加账号",
  "codex.relogin": "重新登录",
  "codex.remove": "退出账号",
  "codex.refresh": "刷新模型与额度",
  "codex.connect": "同步模型",
  "codex.connected": "已同步",
  "codex.code": "在授权页面输入此验证码：",
  "codex.open": "打开授权页面",
  "codex.cancel": "取消登录",
  "codex.waiting": "等待浏览器授权…",
  "codex.empty": "尚未添加 ChatGPT 账号。",
  "codex.window": "{hours} 小时剩余",
  "codex.reset": "{time} 重置",
  "codex.unknown": "额度未知",
  "codex.stale": "额度信息可能已过期，可刷新重试。",
  "codex.required": "请重新登录以使用此账号。",
  "codex.error": "操作失败，请重试。",
  "codex.syncError": "同步模型失败，请重试；账号仍保持登录。",
  "codex.credits": "额外额度：{value}",
  "codex.unlimited": "额外额度不限量",
  "codex.quota": "额度",
  "codex.weekly": "每周剩余",
  "codex.availableModels": "可用模型",
  "codex.noModels": "暂无可用模型，请刷新重试。",
  "codex.more": "账号操作",
};
