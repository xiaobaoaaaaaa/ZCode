import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const evidence = resolve(
  process.argv[2] ?? join(root, "packages/desktop/dist-personal-preview/mock-protocol-evidence"),
);
await mkdir(evidence, { recursive: true });
const home = await mkdtemp(join(tmpdir(), "zcode-personal-mock-suite-"));
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp)$/i.test(key)),
  ),
  ZCODE_DATA_BASE_DIR: home,
  ZCODE_DESKTOP_HOME_DIR: home,
  ZCODE_ENV: "test",
};
const results = [];
try {
  for (const [name, args] of [
    [
      "wire",
      [
        "--test",
        "scripts/test/personal-mock-provider.test.mjs",
        "scripts/test/personal-mock-renderer.test.mjs",
        "scripts/test/personal-mock-workflow.test.mjs",
      ],
    ],
    [
      "memory",
      [
        "--import",
        "tsx",
        "scripts/personal-mock-memory.mjs",
        "--artifacts",
        join(evidence, "memory"),
      ],
    ],
    ["routing", ["--import", "tsx", "scripts/personal-mock-routing.mjs"]],
    ["import", ["--import", "tsx", "scripts/personal-mock-import.mjs"]],
  ]) {
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        env,
        timeout: 120000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (c) => (stdout = (stdout + c).slice(-512 * 1024)));
      child.stderr.on("data", (c) => (stderr = (stderr + c).slice(-512 * 1024)));
      child.once("error", reject);
      child.once("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
    });
    await writeFile(join(evidence, `${name}.log`), result.stdout + "\n" + result.stderr);
    if (result.code === 0 && ["routing", "import"].includes(name)) {
      const summary = JSON.parse(result.stdout);
      if (!summary.evidence?.startsWith(join(tmpdir(), "zcode-mock-")))
        throw new Error("Unexpected fixture evidence path");
      await cp(summary.evidence, join(evidence, name), { recursive: true });
      await rm(summary.evidence, { recursive: true, force: true });
    }
    results.push({ name, code: result.code, signal: result.signal });
    if (result.code !== 0) throw new Error(`${name} failed; see ${join(evidence, `${name}.log`)}`);
  }
  console.log(JSON.stringify({ status: "passed", evidence, results }));
} finally {
  await writeFile(
    join(evidence, "suite-result.json"),
    JSON.stringify({ results, rendererExecuted: false, syntheticOnly: true }, null, 2),
  );
  await rm(home, { recursive: true, force: true });
}
