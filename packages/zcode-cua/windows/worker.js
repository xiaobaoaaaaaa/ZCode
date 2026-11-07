import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { nativeSource } from "./native-source.js";
import { AutomationError } from "./validation.js";

export function createWindowsBackend() {
  let startup;
  let child;
  let directory;
  let disposed = false;
  let pending;
  let exited;
  let stopping;
  const fail = (error) => {
    pending?.reject(error);
    pending = undefined;
  };
  function stopWorker() {
    if (stopping) return stopping;
    disposed = true;
    if (!child || child.exitCode !== null) return Promise.resolve();
    // 先让原生 finally 释放按键和鼠标；UIA 阻塞时才使用有界强制终止。
    stopping = (async () => {
      const watchdog = setTimeout(() => child.kill(), 500);
      child.stdin.end('{"cancel":true}\n');
      await exited;
      clearTimeout(watchdog);
    })();
    return stopping;
  }
  async function start() {
    if (disposed) throw new AutomationError("CONTROL_STOPPED", "Windows worker closed");
    if (startup) return startup;
    startup = (async () => {
      directory = await mkdtemp(join(tmpdir(), "zcode-open-cua-"));
      const scriptPath = join(directory, "worker.ps1");
      const script = `$ErrorActionPreference = 'Stop'\n[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\nAdd-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms,System.Web.Extensions\n$source = @'\n${nativeSource}\n'@\nAdd-Type -TypeDefinition $source -ReferencedAssemblies @('System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll',[System.Windows.Automation.AutomationElement].Assembly.Location,[System.Windows.Automation.ControlType].Assembly.Location,[System.Windows.Rect].Assembly.Location)\n[ZCodeOpenAutomation]::Initialize()\n[Console]::WriteLine('READY')\ntry { [ZCodeOpenAutomation]::Run() } finally { [ZCodeOpenAutomation]::Shutdown() }\n`;
      await writeFile(scriptPath, `\ufeff${script}`, "utf8");
      if (disposed)
        throw new AutomationError("CONTROL_STOPPED", "Worker closed during preparation");
      const systemRoot = process.env.SystemRoot || process.env.WINDIR;
      if (!systemRoot)
        throw new AutomationError("broker_unavailable", "Windows system directory unavailable");
      child = spawn(
        join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-MTA",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            SystemRoot: systemRoot,
            WINDIR: systemRoot,
            TEMP: tmpdir(),
            TMP: tmpdir(),
            USERPROFILE: process.env.USERPROFILE,
            PATH: join(systemRoot, "System32"),
          },
        },
      );
      child.stdin.on("error", () =>
        fail(new AutomationError("broker_unavailable", "Windows worker input closed", true)),
      );
      // 启动失败只发 close 而不一定有 exit；dispose 也必须能结束。
      exited = new Promise((resolve) => child.once("close", resolve));
      let stderr = "";
      child.stderr.on("data", (data) => {
        stderr = (stderr + data.toString()).slice(-6000);
      });
      await new Promise((resolve, reject) => {
        const readyTimer = setTimeout(() => {
          child.kill();
          reject(new AutomationError("timeout", "Windows UIA worker startup timed out"));
        }, 30000);
        const reader = createInterface({ input: child.stdout });
        reader.on("line", (line) => {
          if (line === "READY") {
            clearTimeout(readyTimer);
            resolve();
            return;
          }
          const current = pending;
          pending = undefined;
          if (!current) return;
          try {
            current.resolve(JSON.parse(line));
          } catch {
            current.reject(
              new AutomationError("internal", "Malformed Windows worker response", true),
            );
          }
        });
        child.once("error", (error) => {
          clearTimeout(readyTimer);
          reject(error);
          fail(new AutomationError("broker_unavailable", "Unable to start Windows UIA worker"));
        });
        child.once("exit", () => {
          disposed = true;
          clearTimeout(readyTimer);
          reject(new AutomationError("broker_unavailable", `Windows UIA worker exited: ${stderr}`));
          fail(
            new AutomationError(
              "broker_unavailable",
              "Windows UIA worker exited; request was not replayed",
              true,
            ),
          );
        });
      });
    })();
    return startup;
  }
  return {
    async call(request, signal) {
      // 取消会终止这一代 worker：丢失收据时绝不能自动再发一次输入。
      if (signal?.aborted) throw new AutomationError("CONTROL_STOPPED", "Call cancelled");
      if (request.method === "release" && !startup) return { stopped: true };
      await start();
      if (disposed || signal?.aborted)
        throw new AutomationError("CONTROL_STOPPED", "Call cancelled");
      if (pending)
        throw new AutomationError(
          "controller_busy",
          "Windows worker accepts one request at a time",
        );
      return new Promise((resolve, reject) => {
        const cancel = () => {
          void stopWorker();
          fail(
            new AutomationError(
              "CONTROL_STOPPED",
              "Call cancelled; request was not replayed",
              true,
            ),
          );
        };
        const timer = setTimeout(cancel, 25000);
        const finish = (fn, value) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          fn(value);
        };
        pending = { resolve: (v) => finish(resolve, v), reject: (e) => finish(reject, e) };
        signal?.addEventListener("abort", cancel, { once: true });
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error)
            fail(new AutomationError("broker_unavailable", "Cannot send to Windows worker", true));
        });
      });
    },
    async dispose() {
      disposed = true;
      await stopWorker();
      await startup?.catch(() => undefined);
      await exited;
      if (directory) await rm(directory, { recursive: true, force: true });
    },
  };
}
