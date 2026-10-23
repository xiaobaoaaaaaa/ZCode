import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
test("inert mock workflow preserves permissions and existing steps and exposes new execution explicitly", async () => {
  const root = new URL("../../", import.meta.url);
  const current = YAML.parse(
    await readFile(new URL(".github/workflows/personal-validation.yml", root), "utf8"),
  );
  const proposal = YAML.parse(
    await readFile(new URL("docs/personal/mock-e2e.workflow.txt", root), "utf8"),
  );
  assert.deepEqual(proposal.on, current.on);
  assert.deepEqual(proposal.permissions, current.permissions);
  const steps = proposal.jobs["windows-source-build"].steps;
  const added = steps.filter(
    (s) =>
      s.name?.startsWith("Personal synthetic model") ||
      s.name === "Preserve synthetic model evidence including failures",
  );
  assert.equal(added.length, 3);
  assert.deepEqual(
    steps.filter((s) => !added.includes(s)),
    current.jobs["windows-source-build"].steps,
  );
  assert.equal(added[0].run, "node scripts/personal-mock-suite.mjs");
  assert.equal(added[1].run, "node scripts/personal-mock-renderer.mjs");
  assert.equal(added[2].if, "always()");
  assert.ok(
    steps.indexOf(added[1]) >
      steps.findIndex((s) => s.run === "node scripts/personal-windows-smoke.mjs"),
  );
  for (const path of [
    "scripts/personal-mock-renderer.mjs",
    "scripts/personal-mock-renderer-seed.mjs",
  ]) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.ok(!source.includes("--no-sandbox"));
  }
});
