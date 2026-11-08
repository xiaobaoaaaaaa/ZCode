import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const applicationId = "io.github.xiaobaoaaaaaa.zcode";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function validate(m) {
  assert.match(m.version, /^\d+\.\d+\.\d+-personal\.[1-9]\d*$/);
  assert.match(m.commit, /^[a-f0-9]{40}$/);
  assert.match(m.certificateSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(m.versionCode) && m.versionCode > 0);
}
export async function stageAndroid(apk, destination, metadata) {
  validate(metadata);
  const bytes = await readFile(apk);
  assert.equal(bytes.subarray(0, 4).toString("hex"), "504b0304");
  const name = `ZCode-Personal-${metadata.version}-android.apk`;
  const manifest = { ...metadata, applicationId, name, size: bytes.length, sha256: sha256(bytes) };
  await mkdir(destination, { recursive: true });
  await copyFile(apk, join(destination, name));
  await writeFile(
    join(destination, "android-release.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
export async function collectAndroid(source, destination, expected) {
  const m = JSON.parse(await readFile(join(source, "android-release.json"), "utf8"));
  validate(m);
  for (const key of ["version", "versionCode", "commit"]) assert.equal(m[key], expected[key]);
  assert.equal(m.applicationId, applicationId);
  assert.equal(m.name, `ZCode-Personal-${m.version}-android.apk`);
  const bytes = await readFile(join(source, m.name));
  assert.equal(bytes.length, m.size);
  assert.equal(sha256(bytes), m.sha256);
  await mkdir(destination, { recursive: true });
  await copyFile(join(source, m.name), join(destination, m.name));
  const metadata = await readFile(join(source, "android-release.json"));
  await writeFile(join(destination, "android-release.json"), metadata);
  await appendFile(
    join(destination, "SHA256SUMS"),
    `${m.sha256}  ${m.name}\n${sha256(metadata)}  android-release.json\n`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, source, destination] = process.argv.slice(2);
  const { version } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const properties = await readFile(
    new URL("../packages/android/version.properties", import.meta.url),
    "utf8",
  );
  const versionCode = Number(properties.match(/^VERSION_CODE=(\d+)$/m)?.[1]);
  const metadata = {
    version,
    versionCode,
    commit: process.env.GITHUB_SHA,
    certificateSha256: process.env.ANDROID_CERTIFICATE_SHA256,
  };
  if (command === "stage") await stageAndroid(source, destination, metadata);
  else if (command === "collect") await collectAndroid(source, destination, metadata);
  else throw new Error("Expected stage or collect");
}
