import assert from "node:assert/strict";
import { app, ipcMain, shell } from "electron";
import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import pkg from "electron-updater";
import semver from "semver";
import {
  initAutoUpdater,
  getAutoUpdaterState,
  onAutoUpdaterStateChanged,
  downloadAvailableUpdate,
  cancelDownloadingUpdate,
} from "../src/main/autoUpdater.ts";
import { PersonalGitHubUpdateProvider } from "../src/main/manifestUpdateProvider.ts";

const scenario = JSON.parse(process.env.ZCODE_PERSONAL_SMOKE_SCENARIO);
const root = process.env.ZCODE_PERSONAL_SMOKE_ROOT;
const origin = process.env.ZCODE_PERSONAL_SMOKE_ORIGIN;
app.setPath("userData", root);
Object.defineProperty(app, "isPackaged", { value: true });
app.getVersion = () => "3.17.1-personal.3";
const { autoUpdater } = pkg;
autoUpdater.currentVersion = new semver.SemVer(app.getVersion());
autoUpdater.forceDevUpdateConfig = true;
const states = [],
  errors = [],
  opened = [],
  installOrder = [];
shell.openExternal = async (url) => {
  opened.push(url);
};
const handlers = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  handlers.set(channel, handler);
  originalHandle(channel, handler);
};
autoUpdater.on("error", (error) => errors.push(error.message));
onAutoUpdaterStateChanged((state) => states.push(state));

function waitForState(predicate) {
  if (predicate(getAutoUpdaterState())) return Promise.resolve(getAutoUpdaterState());
  return new Promise((resolveState) => {
    const dispose = onAutoUpdaterStateChanged((state) => {
      if (predicate(state)) {
        dispose();
        resolveState(state);
      }
    });
  });
}

async function run() {
  await app.whenReady();
  if (scenario.mode === "appimage") {
    process.env.APPIMAGE = resolve(root, "current.AppImage");
    await writeFile(process.env.APPIMAGE, "isolated installed AppImage fixture");
  }
  const config = resolve(root, "app-update.yml");
  await writeFile(
    config,
    "provider: generic\nurl: http://127.0.0.1:1\nupdaterCacheDirName: personal-smoke\n",
  );
  autoUpdater.updateConfigPath = config;
  // 任何输入覆盖都不能成为 Personal 的安装源；网络实际落到 runner 提供的固定源夹具。
  process.env.ZCODE_UPDATE_FEED_URL = "http://127.0.0.1:1/override";
  process.argv.push("--zcode-update-feed-url=http://127.0.0.1:1/argv");
  let settings = {
    receivePreviewUpdates: scenario.name === "preview",
    autoDownloadAndInstallUpdates: scenario.mode === "mac",
  };
  const finalCheck = new Promise((resolveCheck) => {
    autoUpdater.once("update-available", resolveCheck);
    autoUpdater.once("update-not-available", resolveCheck);
    autoUpdater.once("error", resolveCheck);
  });
  await initAutoUpdater({
    enabled: true,
    settingService: {
      get: async () => settings,
      update: async (delta) => {
        settings = { ...settings, ...delta };
      },
    },
    updateFeedSource: { url: "http://127.0.0.1:1/direct" },
    resolveEndpointOrigin: () => "http://127.0.0.1:1/backend",
    onBeforeQuitAndInstall: async () => {
      installOrder.push("prepare");
    },
  });
  await finalCheck;
  await nextTurn();
  if (["no-update", "older", "official-only"].includes(scenario.name)) {
    assert.equal(getAutoUpdaterState().kind, "idle");
    assert.equal(errors.length, 0);
  } else if (
    ["wrong-version", "wrong-name", "bad-hash", "http-error", "missing-format"].includes(
      scenario.name,
    )
  ) {
    assert.equal(getAutoUpdaterState().kind, "idle");
    assert.ok(errors.length > 0);
  } else {
    assert.equal(getAutoUpdaterState().kind, "update-available");
    assert.equal(
      getAutoUpdaterState().version,
      scenario.name === "preview" ? "3.17.1-personal.6" : "3.17.1-personal.4",
    );
    if (scenario.mode === "mac") {
      assert.equal(getAutoUpdaterState().manualDownload, true);
      assert.deepEqual(opened, []);
      await handlers.get("zcode:download-update")();
      assert.deepEqual(opened, [origin + "/releases/tag/v3.17.1-personal.4"]);
      assert.equal(getAutoUpdaterState().kind, "update-available");
    } else if (scenario.name === "preview") {
      assert.equal(getAutoUpdaterState().channel, "preview");
    } else {
      if (scenario.name === "cancel") {
        const cancelled = new Promise((resolveCancelled) => {
          const dispose = onAutoUpdaterStateChanged((state) => {
            if (state.kind === "download-progress") {
              dispose();
              cancelDownloadingUpdate();
              resolveCancelled();
            }
          });
        });
        downloadAvailableUpdate();
        const cancelledDownload = autoUpdater.downloadPromise;
        await cancelled;
        await cancelledDownload.catch(() => {});
        await waitForState((state) => state.kind === "update-available");
        await nextTurn();
      }
      const complete =
        scenario.name === "corrupt-download"
          ? new Promise((done) => autoUpdater.once("error", done))
          : waitForState((state) => state.kind === "update-downloaded");
      downloadAvailableUpdate();
      await complete;
      await nextTurn();
      if (scenario.name === "corrupt-download") {
        assert.ok(errors.some((message) => /checksum/i.test(message)));
        assert.notEqual(getAutoUpdaterState().kind, "update-downloaded");
      } else {
        assert.equal(getAutoUpdaterState().version, "3.17.1-personal.4");
        assert.ok(states.some((state) => state.kind === "download-progress"));
        // 等待下载完成触发的自动复查收口，再模拟下一次轮询。
        await autoUpdater.checkForUpdates();
        await nextTurn();
        // 校验同一上游版本下 Personal 序号更新，ready 旧包不能掩盖更新目标。
        await fetch(origin + "/advance");
        const nextVersion = waitForState(
          (state) => state.kind === "update-available" && state.version === "3.17.1-personal.5",
        );
        await autoUpdater.checkForUpdates();
        await nextVersion;
        await nextTurn();
        const ready = waitForState(
          (state) => state.kind === "update-downloaded" && state.version === "3.17.1-personal.5",
        );
        downloadAvailableUpdate();
        await ready;
        await nextTurn();
        // 只替换系统安装执行端，验证真实 Main IPC 的退出准备顺序和重复命令幂等性。
        autoUpdater.quitAndInstall = () => {
          installOrder.push("install");
        };
        await Promise.all([
          handlers.get("zcode:quit-and-install-update")(),
          handlers.get("zcode:quit-and-install-update")(),
        ]);
        assert.deepEqual(installOrder, ["prepare", "install"]);
        assert.deepEqual(errors, []);
      }
    }
  }
  // 同一解析器逐一验证两个架构，使用实际 electron-updater 包格式适配器。
  if (scenario.name === "update" && scenario.mode !== "mac") {
    for (const arch of ["x86_64", "aarch64"]) {
      if (scenario.mode === "nsis" && arch !== "x86_64") continue;
      const provider = new PersonalGitHubUpdateProvider(
        {
          provider: "custom",
          updateProvider: PersonalGitHubUpdateProvider,
          releasePlatform: `${scenario.mode === "nsis" ? "windows" : "linux"}-${arch}`,
        },
        autoUpdater,
        {
          executor: autoUpdater.httpExecutor,
          platform: scenario.mode === "nsis" ? "win32" : "linux",
          isUseMultipleRangeRequest: false,
        },
      );
      const info = await provider.getLatestVersion();
      const files = provider.resolveFiles(info);
      assert.equal(files.length, 1);
      assert.ok(files[0].url.pathname.endsWith(scenario.extension));
      if (scenario.mode === "pacman") assert.ok(!files[0].info.url.includes("/"));
    }
  }
  await writeFile(
    resolve(root, "result.json"),
    JSON.stringify({ scenario, states, errors, opened, installOrder }, null, 2),
  );
  assert.ok((await readFile(resolve(root, "result.json"), "utf8")).length);
  app.exit(0);
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
