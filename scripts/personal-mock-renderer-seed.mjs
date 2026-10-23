import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// Only ordinary user-configurable BYOK/provider preferences; no account identity or entitlement fixtures.
export async function seedRendererProfile(home, baseURL, workspace) {
  const url = new URL(baseURL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.protocol, "http:");
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.ok(Number(url.port) > 0);

  const helpers = await import(
    pathToFileURL(
      resolve(
        import.meta.dirname,
        "../packages/desktop/test/e2e/helpers/model-provider-restart-config.ts",
      ),
    ).href
  );
  const { appSettingsSchema, appSettingsPatchSchema } = await import(
    pathToFileURL(resolve(import.meta.dirname, "../packages/shared/src/validationAppSettings.ts"))
      .href
  );
  const configDir = join(home, ".zcode-personal", "v2");
  await mkdir(configDir, { recursive: true });
  const providerFile = join(configDir, "provider_config.json");
  await helpers.seedPersonalProviderConfig(providerFile, {
    id: "personal-mock",
    label: "Local synthetic test provider",
    apiFormat: "anthropic-messages",
    apiKey: "fake-personal-mock-not-a-credential",
    baseURL,
    enabled: true,
    models: [{ id: "mock-main", supportsMidConversationSystem: true }],
  });
  await helpers.seedPersonalDefaultModelSelection(providerFile, {
    providerId: "personal-mock",
    modelId: "mock-main",
    options: { reasoningLevel: "disabled" },
  });
  // UI tests isolate memory extraction noise; memory behavior has its own real-runtime suite.
  const globalRoot = join(home, ".zcode-personal", "cli", "memories", "global");
  await mkdir(join(globalRoot, "memory"), { recursive: true });
  await writeFile(
    join(globalRoot, "config.json"),
    JSON.stringify({
      enabled: false,
      extractionEnabled: false,
      generation: 0,
      disabledSessionIds: [],
    }),
  );
  const settingsPath = join(configDir, "setting.json");
  await writeFile(
    settingsPath,
    JSON.stringify(
      appSettingsPatchSchema.parse({
        locale: "en-US",
        localePreference: "en-US",
        providerFamilyDomain: "zai",
        providerFamilyDomainMigrated: true,
        memoryEnabled: false,
        lastWorkspaceSession: [
          { kind: "local", workspacePath: workspace, workspacePurpose: "project" },
        ],
        lastActiveTabIndex: 0,
      }),
      null,
      2,
    ),
  );
  appSettingsSchema.parse(JSON.parse(await readFile(settingsPath, "utf8")));
}
if (process.argv[2]) await seedRendererProfile(process.argv[2], process.argv[3], process.argv[4]);
