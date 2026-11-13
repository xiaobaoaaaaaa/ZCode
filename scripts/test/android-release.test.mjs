import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageAndroid, collectAndroid } from "../android-release.mjs";
test("Android release binds APK to version, commit and checksum", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "android-release-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const apk = join(root, "input.apk");
  await writeFile(apk, Buffer.from("504b0304abcd", "hex"));
  const metadata = {
    version: "3.17.2-personal.4",
    versionCode: 1,
    commit: "a".repeat(40),
    certificateSha256: "b".repeat(64),
  };
  await stageAndroid(apk, join(root, "stage"), metadata);
  await collectAndroid(join(root, "stage"), join(root, "out"), metadata);
  await assert.rejects(
    collectAndroid(join(root, "stage"), join(root, "bad"), { ...metadata, commit: "c".repeat(40) }),
  );
  await assert.rejects(
    collectAndroid(join(root, "stage"), join(root, "bad"), { ...metadata, versionCode: 2 }),
  );
  const manifest = JSON.parse(await readFile(join(root, "stage", "android-release.json")));
  await writeFile(join(root, "stage", manifest.name), "tampered");
  await assert.rejects(collectAndroid(join(root, "stage"), join(root, "bad"), metadata));
});
