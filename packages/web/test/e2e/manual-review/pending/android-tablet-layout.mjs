// Browser: pnpm exec tsx packages/web/test/e2e/manual-review/pending/android-tablet-layout.mjs
// Android: ANDROID_TABLET=1 ANDROID_SERIAL=emulator-5556 <same command>
// Open the debug APK first; Playwright connects directly to its WebView CDP over ADB.
// This script never installs/builds an APK or targets a real phone.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, _android } from "playwright-core";
import { ServiceChannels } from "@zcode/shared";
import { V4_WIRE_PROTOCOL_VERSION } from "@zcode/shared/zcode-protocol-v4";
import { Emitter } from "../../../../../rpc/src/index.ts";
import { setup, assertEventually } from "./remote-login-v2.helpers.mjs";
import { createDeviceSwitchDesktopBridge } from "./remote-device-switch.helpers.mjs";
import { taskSnapshotFrame } from "./remote-task-open.fixture.mjs";

const run = promisify(execFile);
const android = process.env.ANDROID_TABLET === "1";
const baseline = process.env.TABLET_LAYOUT_BASELINE === "1";
const serial = process.env.ANDROID_SERIAL || "emulator-5556";
assert.match(serial, /^emulator-\d+$/, "Only an emulator may be used for tablet acceptance");
const origin = process.env.REMOTE_LOGIN_E2E_ORIGIN || "http://127.0.0.1:5178";
const artifacts = resolve(
  process.env.TABLET_ARTIFACT_DIR ||
    `.tmp/android-tablet-layout/${android ? "android" : "browser"}`,
);
await mkdir(artifacts, { recursive: true });
// WebView不支持Browser.setDownloadBehavior；使用Playwright的Android CDP入口，避免桌面Browser context命令。
const devices = android ? await _android.devices({ omitDriverInstall: true }) : [];
const androidDevice = devices.find((device) => device.serial() === serial);
for (const device of devices) if (device !== androidDevice) await device.close();
const webView = android
  ? await androidDevice.webView({ pkg: "io.github.xiaobaoaaaaaa.zcode.debug" })
  : null;
const androidContext = webView ? await webView.page().then((page) => page.context()) : null;
const browser = android
  ? { contexts: () => [androidContext], close: () => androidDevice.close() }
  : await chromium.launch({ headless: true });
const results = [];
const path = "/workspace/tablet";
const taskId = "TABLET_TASK";
const project = {
  id: "tablet-project",
  hostId: "local",
  name: "Tablet project",
  roots: [{ rootPath: path, position: 0, isPrimary: true }],
  nameOverridden: true,
  pinned: false,
  deleted: false,
  position: 0,
  createdAt: 1,
  updatedAt: 2,
};
const task = {
  taskId,
  projectId: project.id,
  hostId: "local",
  workspacePath: path,
  title: "Tablet conversation",
  createdAt: 1,
  updatedAt: 2,
  pinned: false,
  archived: false,
  mode: "default",
  status: "completed",
};
const workspace = { workspacePath: path, kind: "local", label: "Tablet workspace" };
const adb = (...args) => run("adb", ["-s", serial, ...args]);

async function installFixture(page, locale, theme) {
  const frames = new Map();
  const bridges = new Map();
  const send = (socket, payload) => socket.send(JSON.stringify({ type: "data", payload }));
  await page.routeWebSocket(/\/api\/v1\/remote\/ws2(?:\?|$)/, (socket) => {
    socket.onClose(() => {
      for (const bridge of bridges.values()) bridge.dispose();
      bridges.clear();
    });
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "auth_init")
        socket.send(
          JSON.stringify({ type: "auth_ack", device_sid: "e2e-device", pair_status: "matched" }),
        );
      if (message.type === "pair_status_query")
        socket.send(JSON.stringify({ type: "pair_status_ack", pair_status: "matched" }));
      const p = message.payload;
      if (!p) return;
      if (p.zcode_type === "rpc-frame" || p.zcode_type === "rpc-frame-ack") {
        bridges.get(p.bridgeSessionId)?.acceptPayload(p);
        return;
      }
      const result = {
        windowControlSessionId: "e2e-device",
        workspaces: [workspace],
        initialViewState: { activeWorkspaceKey: path, activeTaskId: taskId, updatedAt: 1 },
      };
      if (p.zcode_type === "bootstrap-request" || p.zcode_type === "workspace-list-request")
        send(socket, {
          zcode_type: p.zcode_type.replace("request", "response"),
          requestId: p.requestId,
          success: true,
          result,
        });
      if (p.zcode_type === "mobile-view-state-update")
        send(socket, { zcode_type: "mobile-view-state-updated", requestId: p.requestId });
      if (p.zcode_type !== "workspace-bridge-open") return;
      const bridge = {
        ...workspace,
        workspaceKey: path,
        bridgeSessionId: p.bridgeSessionId,
        bridgeGeneration: p.bridgeGeneration,
        initialTaskId: p.taskId,
      };
      const emitter = new Emitter();
      send(socket, {
        zcode_type: "workspace-bridge-ready",
        requestId: p.requestId,
        bridgeSessionId: p.bridgeSessionId,
        bridgeGeneration: p.bridgeGeneration,
        bridge,
      });
      bridges.set(
        p.bridgeSessionId,
        createDeviceSwitchDesktopBridge(socket, bridge, {
          locale,
          theme,
          events: { [`${ServiceChannels.ZCodeAgent}:onDynamicConversationFrame`]: emitter.event },
          responses: {
            [`${ServiceChannels.SettingsSync}:getFirstRunPromptState`]: { handled: true },
            [`${ServiceChannels.Project}:readTree`]: { projects: [project], tasks: [task] },
            [`${ServiceChannels.RemoteProjects}:readDirectory`]: { hosts: [], entries: [] },
            [`${ServiceChannels.ZCodeTask}:getTaskMeta`]: task,
            [`${ServiceChannels.ZCodeAgent}:helloConversationV4`]: {
              kind: "hello",
              protocolVersion: V4_WIRE_PROTOCOL_VERSION,
              connectionId: p.bridgeSessionId,
              clientMode: "web-remote-replayable",
              deliveryProfile: "replayable",
              serverTime: 1,
              auth: {},
              capabilities: {
                nativeDialogs: false,
                localTerminal: false,
                binaryFrames: true,
                compression: "none",
              },
            },
            [`${ServiceChannels.ZCodeAgent}:initializeConversationV4`]: null,
            [`${ServiceChannels.ZCodeAgent}:getSessionLifecycle`]: null,
            [`${ServiceChannels.ZCodeAgent}:subscribeConversationV4`]: (input) => {
              const subscriptionId = `tablet-${frames.size + 1}`;
              frames.set(input.sessionId, () =>
                emitter.fire(taskSnapshotFrame(input.sessionId, subscriptionId)),
              );
              return { ack: { subscriptionId, mode: "snapshot", logEpoch: "e2e" } };
            },
            [`${ServiceChannels.ZCodeAgent}:unsubscribeConversationV4`]: null,
            [`${ServiceChannels.ZCodeAgent}:conversationWorkflowRunsV4`]: { runs: [] },
            [`${ServiceChannels.ZCodeAgent}:conversationPlansV4`]: { plans: [] },
            "file:readdir": [
              { name: "README.md", path: `${path}/README.md`, type: "file", isSymbolicLink: false },
            ],
            "file:watch": null,
          },
        }),
      );
    });
  });
  return frames;
}

async function metrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const candidates = [...document.querySelectorAll(selector)];
      const e =
        candidates.find((node) => {
          const r = node.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.x >= 0 &&
            r.right <= innerWidth + 1 &&
            !node.closest('[aria-hidden="true"]')
          );
        }) || candidates[0];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const style = getComputedStyle(e);
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        visible:
          r.width > 0 &&
          r.height > 0 &&
          r.x >= 0 &&
          r.right <= innerWidth + 1 &&
          r.y < innerHeight &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          !e.closest('[aria-hidden="true"]'),
      };
    };
    return {
      documentEpoch: performance.timeOrigin,
      width: innerWidth,
      height: innerHeight,
      viewport: {
        width: visualViewport.width,
        height: visualViewport.height,
        top: visualViewport.offsetTop,
      },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      sidebar: rect('[data-testid="sidebar"]'),
      chat: rect('[data-session-id="TABLET_TASK"]'),
      composer: rect('[data-testid="v4-composer-input"]'),
      files: rect('[data-testid="workspace-file-tree-panel"]'),
      mobileHome: rect('[data-mobile-page="home"]'),
      mobileChat: rect('[data-mobile-page="chat"]'),
    };
  });
}

async function capture(page, prefix, check) {
  const measurement = await metrics(page);
  console.log(`observe ${prefix}: ${measurement.width}x${measurement.height}`);
  let error;
  try {
    check(measurement);
  } catch (e) {
    error = e.message;
  }
  await page.screenshot({ path: resolve(artifacts, `${prefix}.png`) });
  if (android) {
    const { stdout } = await run("adb", ["-s", serial, "exec-out", "screencap", "-p"], {
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
    });
    await writeFile(resolve(artifacts, `${prefix}-native.png`), stdout);
  }
  results.push({ scenario: prefix, ...measurement, ...(error ? { error } : {}) });
  if (error && !baseline) throw new Error(`${prefix}: ${error}`);
}

async function hideIme(page) {
  if (!android) return;
  const { stdout } = await adb("shell", "dumpsys", "input_method");
  if (/mInputShown=true|isInputViewShown=true/.test(stdout))
    await adb("shell", "input", "keyevent", "4");
  await page.waitForTimeout(400);
}

async function setSize(page, orientation) {
  await hideIme(page);
  if (!android) {
    await page.setViewportSize(
      orientation === "landscape"
        ? { width: 1280, height: 800 }
        : orientation === "portrait"
          ? { width: 800, height: 1280 }
          : { width: 600, height: 800 },
    );
    // 产品resize合并窗口为300ms，等待它及面板动画完成再测量；不等待业务数据。
    await page.waitForTimeout(650);
    return;
  }
  if (orientation === "narrow") {
    // Android自由窗口是真实Activity resize，不通过CDP伪造页面viewport。
    await adb("shell", "wm", "set-display-windowing-mode", "5");
    const { stdout } = await adb("shell", "dumpsys", "activity", "activities");
    const id = stdout.match(
      /io\.github\.xiaobaoaaaaaa\.zcode\.debug\/com\.example\.zcode_mobile\.MainActivity t(\d+)/,
    )?.[1];
    assert.ok(id, "Find tablet app task for native resize");
    await adb("shell", "am", "task", "resize", id, "0", "0", "1200", "1600");
    await page.waitForFunction(() => innerWidth < 768);
  } else {
    await adb("shell", "wm", "set-display-windowing-mode", "1");
    await adb(
      "shell",
      "cmd",
      "window",
      "user-rotation",
      "lock",
      orientation === "landscape" ? "0" : "1",
    );
    await page.waitForFunction(
      (wide) => (wide ? innerWidth > innerHeight : innerHeight > innerWidth),
      orientation === "landscape",
    );
  }
  await page.waitForTimeout(650);
  await hideIme(page);
}

try {
  for (const locale of process.env.TABLET_LOCALE ? [process.env.TABLET_LOCALE] : ["zh-CN", "en-US"])
    for (const theme of process.env.TABLET_THEME
      ? [process.env.TABLET_THEME]
      : ["zai-light", "zai-dark"]) {
      let source = browser;
      if (android) {
        const context = browser.contexts()[0];
        const page = context.pages()[0];
        assert.ok(page, "APK WebView must be open before CDP acceptance");
        source = {
          newContext: async () =>
            new Proxy(context, {
              get(target, key) {
                if (key === "newPage") return async () => page;
                const value = target[key];
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
        };
      }
      const h = await setup(source, { width: 1280, height: 800, locale, theme, signedIn: true });
      const { page } = h;
      page.setDefaultTimeout(20_000);
      const frames = await installFixture(page, locale, theme);
      try {
        if (android)
          await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          });
        await setSize(page, "landscape");
        await page.goto(`${origin}/remote/v4?sid=e2e-device&mid=e2e-mid`);
        const row = page.locator('[data-project-name="Tablet project"]');
        const onboarding = page.getByTestId("onboarding-page");
        const welcome = page.getByRole("dialog", { name: /欢迎使用 ZCode|Welcome to ZCode/ });
        await row.or(onboarding).or(welcome).first().waitFor();
        if (await onboarding.isVisible())
          await onboarding.getByRole("button", { name: /退出引导|Exit onboarding/ }).click();
        if (await welcome.isVisible())
          await welcome.getByRole("button", { name: /^(Close|关闭)$/ }).click();
        await row.waitFor();
        const toggle = row.getByTestId("virtual-project-toggle");
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        await row.getByText("Tablet conversation", { exact: true }).click();
        await assertEventually(() => frames.has(taskId));
        frames.get(taskId)();
        await page.getByText(`E2E_MRO01_${taskId}_HISTORY`, { exact: true }).waitFor();
        const editor = page.getByTestId("v4-composer-input");
        await editor.fill("Tablet unsent draft");
        await hideIme(page);
        const documentEpoch = await page.evaluate(() => performance.timeOrigin);
        const prefix = `${locale}-${theme}`;
        const wide = (m) => {
          assert.ok(m.sidebar?.visible, "Project sidebar must remain visible in wide layout");
          assert.ok(m.chat?.visible, "Conversation must be visible");
          assert.ok(m.composer?.visible, "Composer must be visible");
          assert.ok(!m.overflow, "No horizontal overflow");
        };
        await capture(page, `${prefix}-landscape`, wide);
        await setSize(page, "portrait");
        await capture(page, `${prefix}-portrait`, wide);
        assert.ok((await editor.innerText()).includes("Tablet unsent draft"));
        await setSize(page, "landscape");
        const files = page.getByTestId("virtual-project-files").first();
        if (await files.count()) {
          await row.hover();
          await files.click();
          await page.locator('[data-testid="workspace-file-tree-panel"]:visible').last().waitFor();
          await page.waitForTimeout(400);
          await capture(page, `${prefix}-files`, (m) => {
            wide(m);
            assert.ok(m.files?.visible, "File pane visible with conversation and sidebar");
          });
          if (android && process.env.TABLET_PRESENTATION === "1") {
            await editor.evaluate((element) => element.blur());
            await hideIme(page);
            await page.waitForFunction(() => innerHeight >= 650);
            await capture(page, "final-landscape", (m) => {
              wide(m);
              assert.ok(m.files?.visible);
            });
          }
        } else {
          results.push({
            scenario: `${prefix}-files`,
            error: "File action absent in current layout",
          });
          if (!baseline) throw new Error("File action absent in wide layout");
        }
        await page.getByRole("button", { name: /^(收起侧边面板|Collapse side pane)$/ }).click();
        await page.waitForTimeout(400);
        await setSize(page, "portrait");
        await row.hover();
        if (!(await metrics(page)).files?.visible)
          await page.getByRole("button", { name: /^(展开侧边面板|Expand side pane)$/ }).click();
        await page.locator('[data-testid="workspace-file-tree-panel"]:visible').last().waitFor();
        await page.waitForTimeout(400);
        await capture(page, `${prefix}-portrait-files-before-ime`, (m) => {
          wide(m);
          assert.ok(m.files?.visible);
        });
        if (!android) {
          await page.setViewportSize({ width: 800, height: 800 });
          await page.waitForTimeout(650);
          await capture(page, `${prefix}-height-only`, (m) => {
            assert.equal(m.width, 800);
            assert.ok(
              m.files?.visible,
              "Height-only resize must preserve manually opened file pane",
            );
          });
        } else {
          await adb("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1");
          const beforeIme = await metrics(page);
          await editor.click();
          await page.waitForFunction((height) => innerHeight < height - 100, beforeIme.height);
          await page.waitForTimeout(650);
          const { stdout: imeState } = await adb("shell", "dumpsys", "input_method");
          assert.match(
            imeState,
            /mInputShown=true|isInputViewShown=true/,
            "Real Android IME must be shown",
          );
          await capture(page, `${prefix}-ime-open`, (m) => {
            assert.equal(m.width, beforeIme.width);
            assert.ok(m.files?.visible, "IME height change must preserve file pane");
            assert.ok(m.composer?.visible);
            assert.ok(m.composer.y + m.composer.height <= m.viewport.height + m.viewport.top + 1);
          });
          await hideIme(page);
          await capture(page, `${prefix}-ime-closed`, (m) => {
            assert.equal(m.height, beforeIme.height);
            assert.ok(m.files?.visible);
          });
        }
        // 文件面板在窄屏会呈现为modal drawer；先由用户关闭，再验证Chat导航与草稿。
        await page.getByRole("button", { name: /^(收起侧边面板|Collapse side pane)$/ }).click();
        await page.waitForTimeout(400);
        await setSize(page, "narrow");
        // 宽屏首次选任务不改变mobile.currentPage；先在窄屏真实点选任务建立Chat导航历史。
        if (await page.locator('[data-mobile-page="home"]').isVisible()) {
          await row.getByText("Tablet conversation", { exact: true }).click();
          await editor.waitFor();
        }
        await capture(page, `${prefix}-narrow`, (m) => {
          assert.ok(m.width < 768);
          assert.ok(m.composer?.visible);
          assert.ok(!m.overflow);
        });
        assert.ok((await editor.innerText()).includes("Tablet unsent draft"));
        await setSize(page, "landscape");
        await capture(page, `${prefix}-restored-wide`, (m) => {
          assert.ok(m.chat?.visible);
          assert.ok(m.composer?.visible);
          assert.ok(!m.mobileHome && !m.mobileChat);
          assert.ok(!m.overflow);
        });
        await setSize(page, "narrow");
        await capture(page, `${prefix}-restored-chat`, (m) => {
          assert.ok(m.mobileChat?.visible);
          assert.ok(m.composer?.visible);
        });
        assert.ok((await editor.innerText()).includes("Tablet unsent draft"));
        assert.equal(
          await page.evaluate(() => performance.timeOrigin),
          documentEpoch,
          "Rotation and native window class changes must preserve WebView document",
        );
        await setSize(page, "landscape");
        const newTask = page.getByTestId("task-new-button");
        await newTask.click();
        await page.locator('[data-workspace-header-variant="draft"]').waitFor();
        await capture(page, `${prefix}-new-draft-header`, (m) => {
          assert.ok(m.composer?.visible);
          assert.ok(!m.overflow);
        });
        assert.ok(
          await page
            .locator('[data-workspace-header-variant="draft"]')
            .getByTestId("side-pane-toggle")
            .isVisible(),
          "Wide draft header must expose the side pane button",
        );
        assert.deepEqual(h.errors, []);
      } catch (error) {
        results.push({ scenario: `${locale}-${theme}-fatal`, error: error.message });
        await page.screenshot({ path: resolve(artifacts, `${locale}-${theme}-failure.png`) });
        if (!baseline) throw error;
      } finally {
        if (!android) await h.context.close();
      }
    }
} finally {
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
assert.ok(
  !results.some((result) => result.error),
  `Tablet acceptance failures: ${JSON.stringify(results.filter((result) => result.error))}`,
);
console.log(`PASS: ${results.length} tablet layout observations; ${artifacts}`);
