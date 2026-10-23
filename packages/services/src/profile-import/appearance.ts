import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { readProjectMemoryFileFromStableHandle } from "../memory/projectMemoryStableRead.js";
import { overlaps, plainAncestors } from "./pathSafety.js";
import type {
  AppearanceImportContract,
  AppearanceImportPreview,
  AppearanceImportReport,
  ImportableAppearance,
} from "./contract.js";

async function readAppearance(source: string) {
  const parent = join(source, "v2");
  await plainAncestors(parent);
  const { content } = await readProjectMemoryFileFromStableHandle({
    fileName: "setting.json",
    filePath: join(parent, "setting.json"),
    maxBytes: 256 * 1024,
    validatePath: () => plainAncestors(parent),
  });
  const raw: unknown = JSON.parse(content);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Unsupported settings object");
  const settings: ImportableAppearance = {};
  const values = raw as Record<string, unknown>;
  if (Object.hasOwn(values, "locale")) {
    if (values.locale !== "en-US" && values.locale !== "zh-CN")
      throw new Error("Unsupported locale");
    settings.locale = values.locale;
  }
  if (Object.hasOwn(values, "localePreference")) {
    if (!["system", "en-US", "zh-CN"].includes(String(values.localePreference)))
      throw new Error("Unsupported locale preference");
    settings.localePreference = values.localePreference as ImportableAppearance["localePreference"];
  } else if (settings.locale) settings.localePreference = settings.locale;
  if (settings.localePreference && settings.localePreference !== "system")
    settings.locale = settings.localePreference;
  if (Object.hasOwn(values, "desktopZoomLevel")) {
    if (
      typeof values.desktopZoomLevel !== "number" ||
      !Number.isInteger(values.desktopZoomLevel) ||
      values.desktopZoomLevel < -3 ||
      values.desktopZoomLevel > 5
    )
      throw new Error("Unsupported desktop zoom level");
    settings.desktopZoomLevel = values.desktopZoomLevel;
  }
  return { settings, digest: createHash("sha256").update(content).digest("hex") };
}

/** The SettingService owns destination validation, lock, conditional merge and persistence. */
export function createAppearanceImporter(
  destinationProfile: string,
  commit: (
    settings: ImportableAppearance,
    validateTarget: () => Promise<void>,
  ) => Promise<AppearanceImportReport>,
): AppearanceImportContract {
  let busy = false;
  let lease: { preview: AppearanceImportPreview; digest: string; expires: number } | undefined;
  return {
    async previewAppearanceImport(params) {
      if (busy) throw new Error("Appearance import already running");
      if (!params || typeof params.source !== "string" || !isAbsolute(params.source))
        throw new Error("Select an absolute official profile path");
      const source = resolve(params.source);
      if (overlaps(source, destinationProfile) || overlaps(destinationProfile, source))
        throw new Error("Source and personal settings must be separate");
      busy = true;
      lease = undefined;
      try {
        const data = await readAppearance(source);
        const preview = { token: randomUUID(), source, settings: data.settings };
        lease = { preview, digest: data.digest, expires: Date.now() + 10 * 60_000 };
        return preview;
      } finally {
        busy = false;
      }
    },
    async confirmAppearanceImport(params) {
      if (busy) throw new Error("Appearance import already running");
      const current = lease;
      if (
        !current ||
        !params ||
        params.token !== current.preview.token ||
        Date.now() > current.expires
      )
        throw new Error("Preview expired; preview the source again");
      lease = undefined;
      busy = true;
      try {
        const data = await readAppearance(current.preview.source);
        if (data.digest !== current.digest)
          throw new Error("Source settings changed; preview again");
        await plainAncestors(destinationProfile, true);
        return await commit(data.settings, () => plainAncestors(join(destinationProfile, "v2")));
      } finally {
        busy = false;
      }
    },
  };
}
