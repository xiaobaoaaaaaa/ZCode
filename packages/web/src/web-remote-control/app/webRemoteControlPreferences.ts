import {
  isWebRemoteControlBridgeableWorkspaceTarget,
  resolveWebRemoteControlWorkspaceKey,
  type WebRemoteControlWindowBootstrapResult,
} from "@zcode/shared";
import type { WebRemoteControlSavedNavigation } from "#src/web-remote-control/contract.js";
import { resolveWebRemoteControlRecoveryTarget } from "#src/web-remote-control/app/webRemoteControlBridgeRecovery.js";

const LIMIT = 50;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** 本地偏好不参与鉴权；账号未知时不读取/写入，避免共用匿名桶污染另一个账号。 */
export function createWebRemoteControlPreferences(
  storage: Pick<Storage, "getItem" | "setItem">,
  origin: string,
  accountKey: string | null,
) {
  const key = accountKey
    ? `zcode-web-remote-preferences:v1:${JSON.stringify([origin, accountKey])}`
    : null;
  const read = (): {
    hidden: string[];
    navigation: [string, WebRemoteControlSavedNavigation][];
  } => {
    try {
      const value = key ? JSON.parse(storage.getItem(key) ?? "null") : null;
      return {
        hidden: Array.isArray(value?.hidden) ? value.hidden.filter(text).slice(-LIMIT) : [],
        navigation: Array.isArray(value?.navigation)
          ? value.navigation
              .filter((item: unknown) => {
                if (!Array.isArray(item) || item.length !== 2 || !text(item[0])) return false;
                const view = item[1];
                return (
                  view &&
                  text(view.workspaceKey) &&
                  (view.taskId === undefined || text(view.taskId))
                );
              })
              .slice(-LIMIT)
          : [],
      };
    } catch {
      return { hidden: [], navigation: [] };
    }
  };
  const write = (value: ReturnType<typeof read>) => {
    if (!key) return;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      /* 偏好不可写不阻断连接。 */
    }
  };
  return {
    hiddenDevices: () => new Set(read().hidden),
    hideDevice(mid: string) {
      const value = read();
      value.hidden = [...new Set([...value.hidden, mid])].slice(-LIMIT);
      write(value);
    },
    restoreHiddenDevices() {
      const value = read();
      value.hidden = [];
      write(value);
    },
    readNavigation(device: string): WebRemoteControlSavedNavigation | null {
      const view = read().navigation.find(([id]) => id === device)?.[1];
      return view
        ? { workspaceKey: view.workspaceKey, ...(view.taskId ? { taskId: view.taskId } : {}) }
        : null;
    },
    saveNavigation(device: string, view: WebRemoteControlSavedNavigation) {
      const value = read();
      value.navigation = [
        ...value.navigation.filter(([id]) => id !== device),
        [device, view] as [string, WebRemoteControlSavedNavigation],
      ].slice(-LIMIT);
      write(value);
    },
  };
}

/** Bugfix: 重启后不能盲目恢复旧目录；仅 bootstrap 中仍可 bridge 的目标可以使用本地导航意图。 */
export function resolveSavedWebRemoteControlTarget(
  snapshot: WebRemoteControlWindowBootstrapResult,
  saved: WebRemoteControlSavedNavigation | null,
) {
  if (
    saved &&
    snapshot.workspaces.some(
      (workspace) =>
        resolveWebRemoteControlWorkspaceKey(workspace) === saved.workspaceKey &&
        isWebRemoteControlBridgeableWorkspaceTarget(workspace),
    )
  ) {
    return resolveWebRemoteControlRecoveryTarget(snapshot, {
      preferredWorkspaceKey: saved.workspaceKey,
      preferredTaskId: saved.taskId,
    });
  }
  return resolveWebRemoteControlRecoveryTarget(snapshot);
}
