// 真实浏览器 + Web 入口，受控账号/relay；不替代真实两电脑和 OAuth 验收。
// 先启动 pnpm --filter @zcode/web exec vite --host 127.0.0.1 --port 5178 --strictPort
// pnpm exec tsx packages/web/test/e2e/manual-review/pending/android-device-preferences.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createDeviceSwitchDesktopBridge } from "./remote-device-switch.helpers.mjs";
import { setup } from "./remote-login-v2.helpers.mjs";
const origin = process.env.REMOTE_LOGIN_E2E_ORIGIN || "http://127.0.0.1:5178";
const browser = await chromium.launch({ headless: true });
const artifacts = resolve(".tmp/android-device-preferences");
await mkdir(artifacts, { recursive: true });
try {
  for (const locale of ["zh-CN", "en-US"])
    for (const theme of ["zai-light", "zai-dark"]) {
      const h = await setup(browser, { signedIn: true, lastSid: "e2e-device", locale, theme });
      const { page } = h;
      const deleteRequests = [];
      page.on("request", (request) => {
        if (request.url().includes("/remote/device/delete")) deleteRequests.push(request.url());
      });
      try {
        await page.goto(`${origin}/remote/v4?devices=1`);
        await page
          .getByRole("heading", {
            name: locale === "zh-CN" ? "选择电脑" : "Choose a computer",
            exact: true,
          })
          .waitFor();
        assert.equal(new URL(page.url()).searchParams.has("devices"), false);
        assert.equal(h.traffic.sockets, 0);
        const hide = page.getByRole("button", {
          name:
            locale === "zh-CN"
              ? "在此手机隐藏 Alice’s MacBook"
              : "Hide Alice’s MacBook on this phone",
          exact: true,
        });
        await hide.click();
        await hide.waitFor({ state: "hidden" });
        assert.equal(await hide.count(), 0);
        await page.reload();
        await page
          .getByRole("heading", {
            name: locale === "zh-CN" ? "选择电脑" : "Choose a computer",
            exact: true,
          })
          .waitFor();
        assert.equal(await hide.count(), 0);
        await page
          .getByRole("button", {
            name: locale === "zh-CN" ? "恢复隐藏的电脑（1）" : "Restore hidden computers (1)",
            exact: true,
          })
          .click();
        await hide.waitFor();
        await page.screenshot({ path: resolve(artifacts, `${locale}-${theme}.png`) });
        const result = await page.evaluate(async () => {
          const { createWebRemoteControlPreferences, resolveSavedWebRemoteControlTarget } =
            await import("/src/web-remote-control/index.ts");
          const a = createWebRemoteControlPreferences(localStorage, location.origin, "zai:user-a");
          const b = createWebRemoteControlPreferences(localStorage, location.origin, "zai:user-b");
          a.saveNavigation("computer-a", { workspaceKey: "/a", taskId: "task-a" });
          a.saveNavigation("computer-b", { workspaceKey: "/b", taskId: "task-b" });
          const snapshot = {
            windowControlSessionId: "session",
            workspaces: [{ workspacePath: "/b", kind: "local", label: "B" }],
          };
          return {
            a: a.readNavigation("computer-a"),
            b: a.readNavigation("computer-b"),
            other: b.readNavigation("computer-a"),
            stale: resolveSavedWebRemoteControlTarget(snapshot, a.readNavigation("computer-a")),
            valid: resolveSavedWebRemoteControlTarget(snapshot, a.readNavigation("computer-b")),
          };
        });
        assert.deepEqual(result.a, { workspaceKey: "/a", taskId: "task-a" });
        assert.deepEqual(result.b, { workspaceKey: "/b", taskId: "task-b" });
        assert.equal(result.other, null);
        assert.equal(result.stale.workspaceKey, "/b");
        assert.equal(result.stale.taskId, undefined);
        assert.equal(result.valid.workspaceKey, "/b");
        assert.equal(result.valid.taskId, "task-b");
        assert.deepEqual(h.errors, []);
        assert.equal(deleteRequests.length, 0);
      } finally {
        await h.context.close();
      }
    }

  // 冷启动保存任务已删除：真实 bootstrap/bridge/RPC 经过 Host 替身，明确 null 后回项目。
  const stale = await setup(browser, { signedIn: true });
  let checkedMissingTask = false;
  let requestedTask;
  await stale.context.addInitScript(() => {
    const key = `zcode-web-remote-preferences:v1:${JSON.stringify([location.origin, JSON.stringify(["zai", "e2e-user"])])}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        hidden: [],
        navigation: [["e2e-mid", { workspaceKey: "/workspace/saved", taskId: "removed-task" }]],
      }),
    );
  });
  await stale.page.routeWebSocket(/\/api\/v1\/remote\/ws2(?:\?|$)/, (socket) => {
    let bridge;
    const send = (payload) => socket.send(JSON.stringify({ type: "data", payload }));
    socket.onClose(() => bridge?.dispose());
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "auth_init")
        socket.send(
          JSON.stringify({ type: "auth_ack", device_sid: "e2e-device", pair_status: "matched" }),
        );
      if (message.type === "pair_status_query")
        socket.send(JSON.stringify({ type: "pair_status_ack", pair_status: "matched" }));
      const payload = message.payload;
      if (payload?.zcode_type === "rpc-frame" || payload?.zcode_type === "rpc-frame-ack") {
        bridge?.acceptPayload(payload);
        return;
      }
      const workspace = {
        workspacePath: "/workspace/saved",
        kind: "local",
        label: "Saved workspace",
      };
      if (payload?.zcode_type === "bootstrap-request")
        send({
          zcode_type: "bootstrap-response",
          requestId: payload.requestId,
          success: true,
          result: { windowControlSessionId: "e2e-device", workspaces: [workspace] },
        });
      if (payload?.zcode_type === "workspace-bridge-open") {
        requestedTask = payload.taskId;
        const target = {
          ...workspace,
          workspaceKey: workspace.workspacePath,
          bridgeSessionId: payload.bridgeSessionId,
          bridgeGeneration: payload.bridgeGeneration,
          initialTaskId: payload.taskId,
        };
        send({
          zcode_type: "workspace-bridge-ready",
          requestId: payload.requestId,
          bridgeSessionId: payload.bridgeSessionId,
          bridgeGeneration: payload.bridgeGeneration,
          bridge: target,
        });
        bridge = createDeviceSwitchDesktopBridge(socket, target, {
          locale: "zh-CN",
          theme: "zai-light",
          responses: {
            "zcode-task:getTaskMeta": () => {
              checkedMissingTask = true;
              return null;
            },
          },
        });
      }
    });
  });
  try {
    await stale.page.goto(`${origin}/remote/v4?sid=e2e-device&mid=e2e-mid`);
    await stale.page.waitForFunction(() =>
      Object.entries(localStorage).some(
        ([key, value]) =>
          key.startsWith("zcode-web-remote-preferences:v1:") &&
          JSON.parse(value).navigation?.some(
            ([id, view]) =>
              id === "e2e-mid" && view.workspaceKey === "/workspace/saved" && !view.taskId,
          ),
      ),
    );
    assert.equal(requestedTask, "removed-task");
    assert.equal(checkedMissingTask, true);
    assert.deepEqual(stale.errors, []);
  } finally {
    await stale.context.close();
  }

  console.log(
    "PASS: devices intent, hide/restore persistence, account/device navigation isolation, stale workspace fallback; 4 locale/theme combinations",
  );
} finally {
  await browser.close();
}
