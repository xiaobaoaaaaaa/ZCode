import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { assertPreviewHost, verifyPreviewFiles } from "./personal-windows-preview.mjs";
import { smokeEnvironment, createDevToolsEndpointReader } from "./personal-windows-smoke.mjs";
import { startPersonalMockProvider } from "./personal-mock-provider.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const byPrefix = (page, prefix) => page.locator(`[data-testid^="${prefix}"]`);
async function waitUntil(predicate, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const promptText = (body) => JSON.stringify(body.messages ?? []);
function lastUserPrompt(body) {
  for (const message of [...(body.messages ?? [])].reverse()) {
    if (message.role !== "user") continue;
    const content =
      typeof message.content === "string"
        ? message.content
        : (message.content ?? [])
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
    if (content) return content;
  }
  return "";
}

export async function runPersonalMockRenderer() {
  assertPreviewHost();
  const unpacked = resolve(ROOT, "packages/desktop/dist-personal-preview/win-unpacked");
  await verifyPreviewFiles(unpacked);
  const run = await mkdtemp(join(tmpdir(), "zcode-personal-mock-ui-"));
  const home = join(run, "home");
  const workspace = join(run, "workspace");
  const evidence = resolve(ROOT, "packages/desktop/dist-personal-preview/mock-evidence");
  await Promise.all([home, workspace, evidence].map((path) => mkdir(path, { recursive: true })));
  const fixtureFile = join(workspace, "synthetic-input.txt");
  const sideEffect = join(workspace, "synthetic-effect.txt");
  const deniedFile = join(run, "outside-workspace.txt");
  await writeFile(fixtureFile, "SYNTHETIC_READ_CONTENT");
  const provider = await startPersonalMockProvider();
  let child, browser, page;
  let logs = "";
  const pageErrors = [];
  const checks = [];
  let status = "failed";
  try {
    const seed = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve(import.meta.dirname, "personal-mock-renderer-seed.mjs"),
        home,
        provider.baseURL,
        workspace,
      ],
      { cwd: ROOT, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(seed.status, 0, `Synthetic BYOK seed failed: ${seed.stderr}`);
    const env = smokeEnvironment(process.env, home);
    const endpointReader = createDevToolsEndpointReader();
    child = spawn(
      join(unpacked, "ZCode Personal.exe"),
      ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"],
      { cwd: unpacked, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let spawnError;
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stderr.on("data", (data) => endpointReader(data.toString()));
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        logs = (logs + data.toString()).slice(-512 * 1024);
      });
    await waitUntil(
      () => {
        if (spawnError || child.exitCode !== null)
          throw new Error(`App exited: ${spawnError?.message ?? child.exitCode}`);
        return endpointReader();
      },
      "Chromium endpoint",
      90000,
    );
    const require = createRequire(resolve(ROOT, "packages/desktop/package.json"));
    browser = await require("playwright-core").chromium.connectOverCDP(endpointReader());
    await waitUntil(() => {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find(
          (candidate) =>
            candidate.url().includes("/renderer/") && candidate.url().includes("index.html"),
        );
      return page;
    }, "packaged renderer");
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 2000)));
    const input = byPrefix(page, "v4-composer-input").first();
    await input.waitFor({ state: "visible", timeout: 90000 });
    async function send(text) {
      await input.fill(text);
      await byPrefix(page, "v4-composer-send").first().click();
    }
    async function finished(marker) {
      await page
        .getByText(marker, { exact: true })
        .last()
        .waitFor({ state: "visible", timeout: 60000 });
      await waitUntil(
        async () => !(await byPrefix(page, "v4-stop").first().isVisible()),
        "turn completion",
      );
    }
    async function screenshot(name) {
      await page.screenshot({ path: join(evidence, `${name}.png`) });
    }
    await screenshot("01-byok-ready");
    checks.push("configured-custom-BYOK-without-official-login");

    let releaseCompact;
    const compactGate = new Promise((resolveGate) => {
      releaseCompact = resolveGate;
    });
    let compactCalls = 0;
    provider.setHandler(async ({ body }) => {
      if (!lastUserPrompt(body).includes("MOCK_COMPACT")) return { text: "Nothing to save." };
      if (compactCalls++ === 0)
        return {
          toolCalls: [
            { id: "read_a", name: "Read", input: { file_path: fixtureFile } },
            { id: "read_b", name: "Read", input: { file_path: fixtureFile } },
          ],
        };
      await compactGate;
      return { text: "MOCK_COMPACT_DONE" };
    });
    await send("MOCK_COMPACT Read the synthetic fixture twice.");
    const compact = page.locator('[data-compact-execution="true"]').last();
    await compact.waitFor({ state: "visible", timeout: 60000 });
    const toggle = compact.locator("button[aria-expanded]").first();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await screenshot("02-compact-expanded-running");
    releaseCompact();
    await finished("MOCK_COMPACT_DONE");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    checks.push("compact-default-collapse-expand-choice-survives-live-update");

    let effectCalls = 0;
    provider.setHandler(({ body }) => {
      const prompt = lastUserPrompt(body);
      if (prompt.includes("MOCK_ORIGINAL_EFFECT")) {
        if (effectCalls++ === 0)
          return {
            toolCalls: [
              {
                id: "effect_once",
                name: "Write",
                input: { file_path: sideEffect, content: "SYNTHETIC_EFFECT_ONCE" },
              },
            ],
          };
        return { text: "MOCK_EFFECT_DONE" };
      }
      if (prompt.includes("MOCK_LATER_ORIGINAL")) return { text: "MOCK_LATER_DONE" };
      if (prompt.includes("MOCK_EDITED_BRANCH")) return { text: "MOCK_EDITED_DONE" };
      if (prompt.includes("MOCK_RESTORED_QUERY")) return { text: "MOCK_RESTORED_DONE" };
      return { text: "Nothing to save." };
    });
    await send("MOCK_ORIGINAL_EFFECT Write the one synthetic effect file.");
    // Respect a real permission prompt if normal product policy asks for this fixture write.
    await waitUntil(
      async () =>
        (await page.locator('[data-permission-option-kind="allowOnce"]').first().isVisible()) ||
        (await page.getByText("MOCK_EFFECT_DONE", { exact: true }).isVisible()),
      "write result or real approval",
    );
    const allow = page.locator('[data-permission-option-kind="allowOnce"]').first();
    if (await allow.isVisible()) await allow.click();
    await finished("MOCK_EFFECT_DONE");
    assert.equal(await readFile(sideEffect, "utf8"), "SYNTHETIC_EFFECT_ONCE");
    const effectBefore = await stat(sideEffect);
    await send("MOCK_LATER_ORIGINAL This later branch must be absent after editing.");
    await finished("MOCK_LATER_DONE");
    const originalRow = byPrefix(page, "v4-row-")
      .filter({
        has: page.getByText("MOCK_ORIGINAL_EFFECT Write the one synthetic effect file.", {
          exact: true,
        }),
      })
      .first();
    await originalRow.hover();
    await byPrefix(originalRow, "v4-edit-").first().click();
    await page
      .getByRole("note")
      .filter({ hasText: "file changes are not automatically undone" })
      .first()
      .waitFor({ state: "visible" });
    await byPrefix(page, "v4-edit-input-")
      .first()
      .fill("MOCK_EDITED_BRANCH Replace the early input without undoing files.");
    const editStart = provider.records.length;
    await byPrefix(page, "v4-edit-submit-").first().click();
    await finished("MOCK_EDITED_DONE");
    const edited = provider.records
      .slice(editStart)
      .find((record) => lastUserPrompt(record.body).includes("MOCK_EDITED_BRANCH"));
    assert.ok(edited, "real edited provider request missing");
    assert.ok(!promptText(edited.body).includes("MOCK_LATER_ORIGINAL"));
    assert.equal((await stat(sideEffect)).mtimeMs, effectBefore.mtimeMs);
    await screenshot("03-edited-branch");
    const restoreStart = provider.records.length;
    await page.getByRole("button", { name: "Conversation versions", exact: true }).click();
    await page.getByRole("button", { name: "Restore selected version", exact: true }).click();
    await page
      .getByText("MOCK_LATER_ORIGINAL This later branch must be absent after editing.", {
        exact: true,
      })
      .waitFor({ state: "visible" });
    assert.equal(
      provider.records.length,
      restoreStart,
      "restoring history must not invoke the model",
    );
    assert.equal((await stat(sideEffect)).mtimeMs, effectBefore.mtimeMs);
    await send("MOCK_RESTORED_QUERY Continue the restored context.");
    await finished("MOCK_RESTORED_DONE");
    const restored = provider.records
      .slice(restoreStart)
      .find((record) => lastUserPrompt(record.body).includes("MOCK_RESTORED_QUERY"));
    assert.ok(promptText(restored.body).includes("MOCK_LATER_ORIGINAL"));
    assert.ok(!promptText(restored.body).includes("MOCK_EDITED_BRANCH"));
    await screenshot("04-restored-branch");
    checks.push("early-edit-context-pruned-version-restored-without-model-or-file-replay");

    let approvalCalls = 0;
    provider.setHandler(({ body }) => {
      if (!lastUserPrompt(body).includes("MOCK_APPROVAL")) return { text: "Nothing to save." };
      if (approvalCalls++ === 0)
        return {
          toolCalls: [
            {
              id: "outside_write",
              name: "Write",
              input: { file_path: deniedFile, content: "MUST_NOT_WRITE" },
            },
          ],
        };
      return { text: "MOCK_APPROVAL_DONE" };
    });
    await send(
      "MOCK_APPROVAL Attempt the synthetic outside-workspace write and wait for permission.",
    );
    const deny = page.locator('[data-permission-option-kind="denyOnce"]').first();
    await deny.waitFor({ state: "visible", timeout: 60000 });
    assert.equal(
      await deny.evaluate((node) => Boolean(node.closest('[data-compact-execution="true"]'))),
      false,
    );
    await screenshot("05-approval-visible");
    await deny.click();
    await finished("MOCK_APPROVAL_DONE");
    await assert.rejects(stat(deniedFile), { code: "ENOENT" });
    checks.push("approval-remains-visible-denial-prevents-fixture-write");

    provider.setHandler(({ body }) =>
      lastUserPrompt(body).includes("MOCK_CANCEL") ? { hold: true } : { text: "Nothing to save." },
    );
    const cancelStart = provider.records.length;
    await send("MOCK_CANCEL Hold the synthetic response until I stop it.");
    await waitUntil(
      () =>
        provider.records
          .slice(cancelStart)
          .some((record) => lastUserPrompt(record.body).includes("MOCK_CANCEL")),
      "held real model request",
    );
    await byPrefix(page, "v4-stop").first().click();
    await waitUntil(
      () =>
        provider.records
          .slice(cancelStart)
          .some(
            (record) => lastUserPrompt(record.body).includes("MOCK_CANCEL") && record.cancelled,
          ),
      "HTTP request cancellation",
    );
    await screenshot("06-cancelled");
    checks.push("stop-cancels-real-loopback-request");

    provider.setHandler(({ body }) =>
      lastUserPrompt(body).includes("MOCK_ERROR")
        ? { status: 400, error: "PERSONAL_MOCK_ERROR" }
        : { text: "Nothing to save." },
    );
    await send("MOCK_ERROR Return the synthetic provider failure.");
    const error = page.getByText(/PERSONAL_MOCK_ERROR/).first();
    await error.waitFor({ state: "visible", timeout: 60000 });
    assert.equal(
      await error.evaluate((node) => Boolean(node.closest('[data-compact-execution="true"]'))),
      false,
    );
    await screenshot("07-error-visible");
    checks.push("provider-error-not-hidden-by-compact-execution");
    assert.ok(provider.records.length > 0);
    assert.ok(provider.records.every((record) => record.body.model === "mock-main"));
    status = "passed";
  } finally {
    if (page && !page.isClosed())
      await page.screenshot({ path: join(evidence, "last-renderer.png") }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (child?.pid && child.exitCode === null)
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        timeout: 15000,
        stdio: "ignore",
      });
    await provider.close();
    await writeFile(join(evidence, "startup.log"), logs);
    await writeFile(join(evidence, "requests.json"), JSON.stringify(provider.records, null, 2));
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          status,
          commit: process.env.GITHUB_SHA,
          checks,
          pageErrors,
          syntheticOnly: true,
          officialAuthTested: false,
          realModelCapabilityTested: false,
        },
        null,
        2,
      ),
    );
    await rm(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runPersonalMockRenderer();
