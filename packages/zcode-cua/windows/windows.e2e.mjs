import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createWindowsHost, createBrokerRuntime } from "./index.js";
import { setupComputerUseRuntime } from "../../../apps/zcode-cli/packages/zcode-cua-plugin/scripts/computer-use-client.mjs";

test(
  "real Windows SDK loop on an isolated WinForms fixture",
  { skip: process.platform !== "win32", timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-cua-e2e-"));
    const script = join(directory, "fixture.ps1");
    await writeFile(
      script,
      `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type 'public class FixtureWindow { [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h,int n); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint pid); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,System.UIntPtr extra); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,System.UIntPtr extra); }'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'ZCode Computer Use Test'
$form.Size = New-Object System.Drawing.Size(520,300)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
Add-Type 'public class FixtureKeys { [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key); }'
$keyTimer = New-Object System.Windows.Forms.Timer
$keyTimer.Interval = 20
$script:ctrlWasDown = $false
$keyTimer.Add_Tick({ $down = ([FixtureKeys]::GetAsyncKeyState(17) -band 0x8000) -ne 0; if ($down -ne $script:ctrlWasDown) { $script:ctrlWasDown = $down; [Console]::WriteLine((@{ctrl=$down} | ConvertTo-Json -Compress)) } })
$keyTimer.Start()
$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.AccessibleName = 'Input'
$inputBox.Location = New-Object System.Drawing.Point(20,20)
$inputBox.Width = 350
$applyButton = New-Object System.Windows.Forms.Button
$applyButton.Text = 'Apply'
$applyButton.Location = New-Object System.Drawing.Point(20,65)
$resultLabel = New-Object System.Windows.Forms.Label
$resultLabel.Text = 'Waiting'
$resultLabel.Location = New-Object System.Drawing.Point(20,115)
$resultLabel.Width = 450
$moveButton = New-Object System.Windows.Forms.Button
$moveButton.Text = 'Move'
$moveButton.Location = New-Object System.Drawing.Point(120,65)
$escapeButton = New-Object System.Windows.Forms.Button
$escapeButton.Text = 'Emergency stop'
$escapeButton.Location = New-Object System.Drawing.Point(220,65)
$escapeButton.Width = 150
$escapeTimer = New-Object System.Windows.Forms.Timer
$escapeTimer.Interval = 120
$escapeTimer.Add_Tick({ [FixtureWindow]::keybd_event(27,0,2,[UIntPtr]::Zero); $escapeTimer.Stop() })
$escapeButton.Add_Click({ [FixtureWindow]::keybd_event(27,0,0,[UIntPtr]::Zero); $escapeTimer.Start() })
$applyButton.Add_Click({ $resultLabel.Text = 'Result: ' + $inputBox.Text; $form.Activate(); [void][FixtureWindow]::AllowSetForegroundWindow([uint32]::MaxValue) })
$moveButton.Add_Click({ $form.Left += 30 })
$form.Controls.AddRange(@($inputBox,$applyButton,$moveButton,$escapeButton,$resultLabel))
$form.Add_Shown({ [void][FixtureWindow]::ShowWindow($form.Handle,5); [void][FixtureWindow]::SetForegroundWindow($form.Handle); [void][FixtureWindow]::SetCursorPos(($form.Left+40),($form.Top+50)); [FixtureWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [FixtureWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero); [Console]::WriteLine((@{pid=$PID;window_id=$form.Handle.ToInt64()} | ConvertTo-Json -Compress)) })
[System.Windows.Forms.Application]::Run($form)
`,
      "utf8",
    );
    const fixture = spawn(
      join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let fixtureError = "";
    fixture.stderr.on("data", (data) => {
      fixtureError += data.toString();
    });
    const exit = new Promise((resolve) => fixture.once("exit", resolve));
    const fixtureLines = createInterface({ input: fixture.stdout });
    const waitForControlKey = (down) =>
      new Promise((resolve, reject) => {
        const onLine = (line) => {
          if (JSON.parse(line).ctrl === down) {
            clearTimeout(timer);
            fixtureLines.off("line", onLine);
            resolve();
          }
        };
        const timer = setTimeout(() => {
          fixtureLines.off("line", onLine);
          reject(new Error(`Control key did not become ${down ? "pressed" : "released"}`));
        }, 5000);
        fixtureLines.on("line", onLine);
      });
    const host = createWindowsHost();
    let runtime;
    try {
      const ref = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Fixture startup timeout: ${fixtureError}`)),
          10000,
        );
        fixtureLines.once("line", (line) => {
          clearTimeout(timer);
          resolve(JSON.parse(line));
        });
        fixture.once("error", reject);
      });
      const transport = await host.start();
      runtime = createBrokerRuntime({
        brokerSocketPath: transport.socketPath,
        env: { ZCODE_CUA_PLUGIN_AUTHORITY: transport.pluginAuthority },
      });
      const context = {
        sessionId: "native-e2e",
        runtimeScope: "main",
        workspacePath: directory,
        workspaceKey: directory,
      };
      const call = (toolName, args = {}, otherContext = context) =>
        runtime.execute({ toolName, arguments: args, context: otherContext });
      const globals = {
        [Symbol.for("zcode.node-repl.computer-use-bridge")]: { call },
        nodeRepl: { write() {}, emitImage() {} },
      };
      const cua = await setupComputerUseRuntime({ globals });
      const apps = await cua.listApps({ emit: false });
      assert.ok(
        apps.some((app) => app.pid === ref.pid),
        `Fixture pid=${ref.pid}; discovered pids=${apps.map((app) => app.pid).join(",")}`,
      );
      const app = await cua.getApp(ref);
      let elements = await app.elements();
      const input = elements.find((e) => e.title === "Input");
      const button = elements.find((e) => e.title === "Apply");
      assert.ok(input && button);
      await app.setValue(input.index, "测试 Unicode");
      await app.click(button.index);
      assert.match(await app.getAXState({ emit: false }), /Result: 测试 Unicode/);
      elements = await app.elements();
      assert.equal(
        (await call("get_app_state", { app_ref: ref })).structuredContent.app.active,
        true,
        "Fixture must be foreground before Focus",
      );
      await app.performSecondaryAction(elements.find((e) => e.title === "Input").index, "Focus");
      assert.equal(
        (await call("get_app_state", { app_ref: ref })).structuredContent.app.active,
        true,
        "Fixture must remain foreground after Focus",
      );
      await app.pressKey("ctrl+a");
      await app.typeText("keyboard ✓");
      await app.click(elements.find((e) => e.title === "Apply").index);
      assert.match(await app.getAXState({ emit: false }), /Result: keyboard ✓/);
      const screenshot = await app.getScreenshot({ emit: false });
      assert.equal(Buffer.from(screenshot).subarray(1, 4).toString(), "PNG");
      const competing = await call(
        "set_value",
        { app_ref: ref, target: { type: "element", index: input.index }, value: "wrong" },
        { ...context, sessionId: "competing" },
      );
      assert.equal(competing.structuredContent.code, "controller_busy");
      elements = await app.elements();
      await app.click(elements.find((e) => e.title === "Move").index);
      const stale = await call("left_click", {
        app_ref: ref,
        target: { type: "coordinate", x: 1, y: 1 },
      });
      assert.equal(stale.structuredContent.code, "STALE_STATE");
      await cua.stop("E2E complete");
      await assert.rejects(app.typeText("must not appear"));
      const emergencyContext = { ...context, sessionId: "escape-owner" };
      const observed = await call("get_app_state", { app_ref: ref }, emergencyContext);
      const escapeIndex = observed.structuredContent.elements.find(
        (e) => e.title === "Emergency stop",
      ).index;
      await call(
        "left_click",
        { app_ref: ref, target: { type: "element", index: escapeIndex } },
        emergencyContext,
      );
      // 新 Host 启动自身 worker 后应立即取得 OS mutex；旧 owner 空闲期间也必须释放。
      const nextHost = createWindowsHost();
      let nextRuntime;
      try {
        const nextTransport = await nextHost.start();
        nextRuntime = createBrokerRuntime({
          brokerSocketPath: nextTransport.socketPath,
          env: { ZCODE_CUA_PLUGIN_AUTHORITY: nextTransport.pluginAuthority },
        });
        const next = (toolName, args) =>
          nextRuntime.execute({
            toolName,
            arguments: args,
            context: { ...context, sessionId: "next-host" },
          });
        const nextState = await next("get_app_state", { app_ref: ref });
        const nextInput = nextState.structuredContent.elements.find(
          (e) => e.title === "Input",
        ).index;
        assert.equal(
          (
            await next("set_value", {
              app_ref: ref,
              target: { type: "element", index: nextInput },
              value: "reclaimed",
            })
          ).isError,
          undefined,
        );
        assert.equal(
          (await call("get_app_state", { app_ref: ref }, emergencyContext)).structuredContent.code,
          "CONTROL_STOPPED",
        );
        const pressed = waitForControlKey(true);
        const released = waitForControlKey(false);
        const cancellation = new AbortController();
        const heldKey = nextRuntime.execute({
          toolName: "key",
          arguments: { app_ref: ref, text: "ctrl", hold_seconds: 2 },
          context: { ...context, sessionId: "next-host" },
          signal: cancellation.signal,
        });
        await pressed;
        cancellation.abort();
        assert.equal((await heldKey).isError, true);
        await released;
      } finally {
        await nextRuntime?.dispose();
        await nextHost.stop();
      }
    } finally {
      await runtime?.dispose();
      await host.stop();
      fixture.kill();
      await exit;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
