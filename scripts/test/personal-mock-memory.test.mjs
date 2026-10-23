import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
test(
  "real runtime extracts/recalls/deletes global memory through loopback HTTP and disk",
  { timeout: 120000 },
  async () => {
    const artifacts = await mkdtemp(join(tmpdir(), "personal-memory-test-evidence-"));
    try {
      const result = await new Promise((resolveResult, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "scripts/personal-mock-memory.mjs", "--artifacts", artifacts],
          {
            cwd: root,
            timeout: 90000,
            stdio: ["ignore", "pipe", "pipe"],
            env: Object.fromEntries(
              Object.entries(process.env).filter(([key]) =>
                /^(path|systemroot|windir|temp|tmp)$/i.test(key),
              ),
            ),
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout = (stdout + chunk).slice(-32768);
        });
        child.stderr.on("data", (chunk) => {
          stderr = (stderr + chunk).slice(-32768);
        });
        child.once("error", reject);
        child.once("close", (code) => resolveResult({ code, stdout, stderr }));
      });
      assert.equal(result.code, 0, result.stderr + result.stdout);
      const summary = JSON.parse(await readFile(join(artifacts, "memory-result.json"), "utf8"));
      assert.equal(summary.status, "passed");
      assert.equal(summary.checks.length, 7);
      assert.ok(summary.requests >= 7);
      assert.equal(summary.userDataUsed, false);
      const records = JSON.parse(
        await readFile(join(artifacts, "memory-http-requests.json"), "utf8"),
      );
      assert.ok(
        records.every((record) => JSON.parse(record.requestBody).model === "personal-memory-model"),
      );
      assert.ok(records.every((record) => !Object.hasOwn(record, "requestHeaders")));
      assert.match(
        await readFile(join(artifacts, "memory-persisted-extraction.md"), "utf8"),
        /Source: user session memory-teach-a/,
      );
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
  },
);

test("memory fixture rejects unexpected HTTP routes and models", async () => {
  const { memoryMockResponse } = await import("../personal-mock-memory.mjs");
  const valid = {
    method: "POST",
    url: "/v1/messages",
    body: { model: "personal-memory-model", messages: [] },
  };
  for (const change of [
    { method: "GET" },
    { url: "/oauth/token" },
    { body: { model: "unconfigured-model" } },
  ]) {
    assert.throws(() => memoryMockResponse({ ...valid, ...change }), /Unexpected/);
  }
});
