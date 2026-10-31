import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
const exec = promisify(execFile);

for (const flavor of ["personal", "production"]) {
  test(`upstream configuration additions retain ${flavor} profile isolation`, async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-profile-integration-"));
    const imported = join(root, "imported");
    const dataDir = flavor === "personal" ? ".zcode-personal" : ".zcode";
    try {
      for (const dir of [".zcode", ".zcode-personal"]) {
        const target = join(imported, dir);
        await mkdir(join(target, "commands"), { recursive: true });
        await mkdir(join(target, "cli"), { recursive: true });
        await writeFile(
          join(target, "commands", dir === dataDir ? "selected.md" : "other.md"),
          "---\ndescription: fixture\n---\nfixture command\n",
        );
        await writeFile(
          join(target, "cli", "config.json"),
          JSON.stringify({
            hooks: {
              events: {
                SessionStart: [
                  {
                    hooks: [
                      {
                        type: "command",
                        command: dir === dataDir ? "selected-hook" : "other-hook",
                      },
                    ],
                  },
                ],
              },
            },
          }),
        );
      }
      const outfile = join(root, "probe.cjs");
      await build({
        stdin: {
          contents: `
          import assert from 'node:assert/strict';
          import { join } from 'node:path';
          import { getAgentUserInstructionsFilePath, getZCodeUserRootDir } from './packages/services/src/paths.ts';
          import { createCommandDataSyncMethods } from './packages/services/src/data-sync/commandDataSync.ts';
          import { createHookDataSyncMethods } from './packages/services/src/data-sync/hookDataSync.ts';
          (async () => {
            const expected = join(process.env.ZCODE_PROFILE_BASE_DIR, '${dataDir}');
            assert.equal(getZCodeUserRootDir(), expected);
            assert.equal(getAgentUserInstructionsFilePath(), join(expected, 'AGENTS.md'));
            const commands = await createCommandDataSyncMethods().listSyncItems();
            assert.deepEqual(commands.items.map(i => i.name), ['/selected']);
            const hooks = await createHookDataSyncMethods().listSyncItems();
            assert.equal(hooks.items.length, 1);
            assert.ok(hooks.items[0].description.includes('selected-hook'));
            await createCommandDataSyncMethods().checkSyncWriteAccess();
            await createHookDataSyncMethods().checkSyncWriteAccess();
          })().catch(e => { console.error(e); process.exitCode = 1; });
        `,
          resolveDir: resolve("."),
          loader: "ts",
        },
        bundle: true,
        platform: "node",
        format: "cjs",
        outfile,
        logLevel: "silent",
        define: { __ZCODE_PRODUCT_FLAVOR__: JSON.stringify(flavor), __ZCODE_ENV__: '"production"' },
      });
      const official = join(
        imported,
        flavor === "personal" ? ".zcode" : ".zcode-personal",
        "cli",
        "config.json",
      );
      const before = await readFile(official, "utf8");
      await exec(process.execPath, [outfile], {
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          ZCODE_PROFILE_BASE_DIR: imported,
          ZCODE_DESKTOP_HOME_DIR: imported,
        },
        timeout: 30000,
      });
      assert.equal(await readFile(official, "utf8"), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
