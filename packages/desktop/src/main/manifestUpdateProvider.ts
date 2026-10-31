import { posix } from "node:path";
import type { CustomPublishOptions, PackageFileInfo } from "builder-util-runtime";
import {
  DEFAULT_ZCODE_ENDPOINT_ORIGIN,
  normalizeZCodeEndpointOrigin,
  type ElectronReleaseChannel,
} from "@zcode/shared";
import {
  Provider,
  AppImageUpdater,
  DebUpdater,
  RpmUpdater,
  PacmanUpdater,
  type AppUpdater,
  type ResolvedUpdateFileInfo,
  type UpdateFileInfo,
  type UpdateInfo,
} from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import { parse as parseYaml } from "yaml";
import semver from "semver";

export const ELECTRON_MANIFEST_API_PATH = "/api/v1/releases/electron/manifest";

const MANIFEST_ACCEPT_HEADER = "application/x-yaml,text/yaml,text/plain,*/*";

export interface ManifestUpdateProviderOptions extends CustomPublishOptions {
  endpointOrigin?: string;
  manifestUrl?: string;
  deviceMid?: string;
  releasePlatform?: string;
  releaseChannel?: ElectronReleaseChannel;
  resolveEndpointOrigin?: () => string | Promise<string>;
  resolveReleaseChannel?: () => ElectronReleaseChannel | Promise<ElectronReleaseChannel>;
}

function normalizeReleaseChannel(channel: string | null | undefined): ElectronReleaseChannel {
  return channel === "preview" ? "preview" : "stable";
}

function mapReleaseChannelToApiValue(channel: ElectronReleaseChannel): string {
  return channel === "preview" ? "3" : "1";
}

function mapElectronReleaseArch(arch: string): string {
  switch (arch) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    default:
      return arch;
  }
}

function mapElectronReleasePlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      return platform;
  }
}

export function getElectronReleasePlatform(
  platform: NodeJS.Platform = process.platform,
  arch = process.env["TEST_UPDATER_ARCH"] || process.arch,
): string {
  return `${mapElectronReleasePlatform(platform)}-${mapElectronReleaseArch(arch)}`;
}

export function buildElectronManifestUrl(options: {
  endpointOrigin: string;
  manifestUrl?: string;
  platform: string;
  deviceMid?: string;
  channel: ElectronReleaseChannel;
}): URL {
  const url = options.manifestUrl?.trim()
    ? new URL(options.manifestUrl.trim())
    : new URL(ELECTRON_MANIFEST_API_PATH, normalizeZCodeEndpointOrigin(options.endpointOrigin));
  url.searchParams.set("platform", options.platform);
  if (options.deviceMid?.trim()) {
    url.searchParams.set("device_mid", options.deviceMid.trim());
  }
  url.searchParams.set("channel", mapReleaseChannelToApiValue(options.channel));
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readManifestFileList(updateInfo: UpdateInfo): UpdateFileInfo[] {
  if (Array.isArray(updateInfo.files) && updateInfo.files.length > 0) {
    return updateInfo.files;
  }

  const legacyInfo = updateInfo as UpdateInfo & {
    path?: unknown;
    sha2?: unknown;
    sha512?: unknown;
  };
  if (typeof legacyInfo.path === "string") {
    return [
      {
        url: legacyInfo.path,
        ...(typeof legacyInfo.sha2 === "string" ? { sha2: legacyInfo.sha2 } : {}),
        ...(typeof legacyInfo.sha512 === "string" ? { sha512: legacyInfo.sha512 } : {}),
      } as UpdateFileInfo,
    ];
  }

  throw new Error("Manifest update info does not contain files or path");
}

function resolveManifestUrl(pathname: string, baseUrl: URL): URL {
  return new URL(pathname, baseUrl);
}

function getLinuxUpdateExtensions(updater: AppUpdater): readonly string[] | null {
  // Linux 的实际更新器由安装包类型决定，不能把 deb/rpm/pacman 统一当作
  // 不支持更新的产物删除；复用已有 updater 实例，避免再次读取安装类型产生分歧。
  if (updater instanceof AppImageUpdater) return [".appimage"];
  if (updater instanceof DebUpdater) return [".deb"];
  if (updater instanceof RpmUpdater) return [".rpm"];
  if (updater instanceof PacmanUpdater) return [".pkg.tar.zst", ".pacman"];
  return null;
}

function resolveManifestFiles(
  updateInfo: UpdateInfo,
  baseUrl: URL,
  linuxExtensions: readonly string[] | null,
): ResolvedUpdateFileInfo[] {
  const updateFiles = readManifestFileList(updateInfo).filter((file) => {
    const pathname = resolveManifestUrl(file.url, baseUrl).pathname.toLowerCase();
    return !linuxExtensions || linuxExtensions.some((extension) => pathname.endsWith(extension));
  });
  // 缺少当前格式时，上游 findFile 会回退其他包或返回 undefined，
  // 随后报非法缓存路径/TypeError；在解析边界失败，禁止跨安装格式更新。
  if (updateFiles.length === 0) {
    throw new Error(`Manifest contains no update file for ${linuxExtensions?.join(" / ")}`);
  }
  const resolved: ResolvedUpdateFileInfo[] = updateFiles.map((fileInfo) => {
    if (!fileInfo.sha512 && !("sha2" in fileInfo && fileInfo.sha2)) {
      throw new Error(`Manifest file is missing checksum: ${fileInfo.url}`);
    }

    const url = resolveManifestUrl(fileInfo.url, baseUrl);
    // PacmanUpdater 仍用 .pacman 后缀识别缓存名，.pkg.tar.zst 会退回
    // info.url；只给缓存提供文件名，避免完整 URL 被拼进 pending/temp-https:/...。
    const info = linuxExtensions?.includes(".pkg.tar.zst")
      ? { ...fileInfo, url: posix.basename(decodeURIComponent(url.pathname)) }
      : fileInfo;
    return {
      url,
      info,
    } satisfies ResolvedUpdateFileInfo;
  });

  const packages = isRecord((updateInfo as { packages?: unknown }).packages)
    ? ((updateInfo as { packages?: Record<string, PackageFileInfo> }).packages ?? null)
    : null;
  const packageInfo = packages?.[process.arch] ?? packages?.ia32;
  if (packageInfo && resolved[0]) {
    resolved[0].packageInfo = {
      ...packageInfo,
      path: resolveManifestUrl(packageInfo.path, baseUrl).href,
    };
  }

  return resolved;
}

export class ManifestUpdateProvider extends Provider<UpdateInfo> {
  private readonly options: ManifestUpdateProviderOptions;
  private readonly releasePlatform: string;
  private readonly linuxExtensions: readonly string[] | null;
  private resolveBaseUrl = new URL(DEFAULT_ZCODE_ENDPOINT_ORIGIN);

  constructor(
    options: ManifestUpdateProviderOptions,
    updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.options = options;
    this.linuxExtensions = getLinuxUpdateExtensions(updater);
    this.releasePlatform = options.releasePlatform?.trim() || getElectronReleasePlatform();
    this.resolveBaseUrl = new URL(
      normalizeZCodeEndpointOrigin(options.endpointOrigin ?? DEFAULT_ZCODE_ENDPOINT_ORIGIN),
    );
  }

  override get isUseMultipleRangeRequest(): boolean {
    return false;
  }

  override async getLatestVersion(): Promise<UpdateInfo> {
    const endpointOrigin = await this.resolveEndpointOrigin();
    const releaseChannel = await this.resolveReleaseChannel();
    const manifestUrl = buildElectronManifestUrl({
      endpointOrigin,
      manifestUrl: this.options.manifestUrl,
      platform: this.releasePlatform,
      deviceMid: this.options.deviceMid,
      channel: releaseChannel,
    });
    this.resolveBaseUrl = new URL("/", manifestUrl);
    const releaseChannelApiValue = mapReleaseChannelToApiValue(releaseChannel);

    const raw = await this.httpRequest(manifestUrl, {
      accept: MANIFEST_ACCEPT_HEADER,
      "X-Platform": this.releasePlatform,
      "X-Release-Channel": releaseChannelApiValue,
      ...(this.options.deviceMid?.trim() ? { "X-Device-Mid": this.options.deviceMid.trim() } : {}),
    });
    if (!raw) {
      throw new Error(`Empty electron update manifest: ${manifestUrl.toString()}`);
    }

    const parsed = parseYaml(raw);
    if (!isRecord(parsed) || typeof parsed.version !== "string") {
      throw new Error(`Invalid electron update manifest: ${manifestUrl.toString()}`);
    }

    return {
      ...(parsed as unknown as UpdateInfo),
      // Bugfix: preview/stable 切换时旧 manifest 请求可能晚于新请求返回。
      // electron-updater 的 update-available 事件默认不带请求通道，main 进程无法识别过期结果；
      // 这里把本次请求通道随 UpdateInfo 带回去，避免旧通道覆盖更新弹窗内容。
      zcodeReleaseChannel: releaseChannel,
    } as UpdateInfo;
  }

  override resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    return resolveManifestFiles(updateInfo, this.resolveBaseUrl, this.linuxExtensions);
  }

  private async resolveEndpointOrigin(): Promise<string> {
    const resolved =
      (await this.options.resolveEndpointOrigin?.()) ??
      this.options.endpointOrigin ??
      DEFAULT_ZCODE_ENDPOINT_ORIGIN;
    return normalizeZCodeEndpointOrigin(resolved);
  }

  private async resolveReleaseChannel(): Promise<ElectronReleaseChannel> {
    const resolved =
      (await this.options.resolveReleaseChannel?.()) ?? this.options.releaseChannel ?? "stable";
    return normalizeReleaseChannel(resolved);
  }
}

const PERSONAL_REPOSITORY = "https://github.com/xiaobaoaaaaaa/ZCode";
const PERSONAL_RELEASE_API = "https://api.github.com/repos/xiaobaoaaaaaa/ZCode/releases";
const PERSONAL_VERSION = /^\d+\.\d+\.\d+-personal\.[1-9]\d*$/u;

export function getPersonalReleasePageUrl(version: string): string {
  if (!PERSONAL_VERSION.test(version) || !semver.valid(version)) {
    throw new Error("Invalid Personal release version");
  }
  return `${PERSONAL_REPOSITORY}/releases/tag/v${version}`;
}

/** 固定 fork 的发布适配器；下载和安装状态继续由 Main / electron-updater 持有。 */
export class PersonalGitHubUpdateProvider extends ManifestUpdateProvider {
  private readonly personalOptions: ManifestUpdateProviderOptions;
  private readonly updater: AppUpdater;

  constructor(
    options: ManifestUpdateProviderOptions,
    updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(options, updater, runtimeOptions);
    this.personalOptions = options;
    this.updater = updater;
  }

  override async getLatestVersion(): Promise<UpdateInfo> {
    const channel = normalizeReleaseChannel(
      (await this.personalOptions.resolveReleaseChannel?.()) ?? this.personalOptions.releaseChannel,
    );
    const raw = await this.httpRequest(
      new URL(
        channel === "preview"
          ? `${PERSONAL_RELEASE_API}?per_page=100`
          : `${PERSONAL_RELEASE_API}/latest`,
      ),
      { accept: "application/vnd.github+json" },
    );
    if (!raw) throw new Error("Empty Personal release response");
    const parsed: unknown = JSON.parse(raw);
    if (channel === "preview" ? !Array.isArray(parsed) : !isRecord(parsed)) {
      throw new Error("Invalid Personal release response");
    }
    const releases: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const candidates = releases
      .flatMap((release) => {
        if (
          !isRecord(release) ||
          release.draft !== false ||
          typeof release.prerelease !== "boolean" ||
          (channel === "stable" && release.prerelease) ||
          typeof release.tag_name !== "string"
        )
          return [];
        const version = release.tag_name.replace(/^v/u, "");
        return release.tag_name === `v${version}` &&
          PERSONAL_VERSION.test(version) &&
          semver.valid(version)
          ? [{ release, version }]
          : [];
      })
      .sort((a, b) => semver.rcompare(a.version, b.version));
    const selected = candidates[0];
    const currentVersion = this.updater.currentVersion.version;
    // 老 Release 没有更新用 SHA-512；同版/降版无需读取清单，也绝不回退官方源。
    if (!selected || !semver.gt(selected.version, currentVersion)) {
      return {
        version: currentVersion,
        files: [],
        path: "",
        sha512: "",
        releaseDate: "",
        zcodeReleaseChannel: channel,
      } as UpdateInfo;
    }
    const { release, version } = selected;
    const baseUrl = `${PERSONAL_REPOSITORY}/releases/download/v${version}/`;
    const manifestRaw = await this.httpRequest(new URL(`${baseUrl}release-manifest.json`), {
      accept: "application/json",
    });
    const manifest: unknown = JSON.parse(manifestRaw ?? "null");
    if (!isRecord(manifest) || manifest.version !== version || !Array.isArray(manifest.assets)) {
      throw new Error("Personal release manifest version/assets mismatch");
    }
    const platform = this.personalOptions.releasePlatform ?? getElectronReleasePlatform();
    const target = personalTargetFiles(version, platform);
    const assets = manifest.assets;
    const files = target.map((name) => {
      const records = assets.filter((asset: unknown) => isRecord(asset) && asset.name === name);
      const asset: unknown = records[0];
      if (
        records.length !== 1 ||
        !isRecord(asset) ||
        typeof asset.size !== "number" ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.size > 500 * 1024 * 1024 ||
        typeof asset.sha512 !== "string" ||
        !/^[A-Za-z0-9+/]{86}==$/u.test(asset.sha512)
      ) {
        throw new Error(`Invalid or missing Personal update asset: ${name}`);
      }
      return { url: `${baseUrl}${name}`, size: asset.size, sha512: asset.sha512 };
    });
    return {
      version,
      files,
      path: files[0]!.url,
      sha512: files[0]!.sha512,
      releaseName: typeof release.name === "string" ? release.name : version,
      releaseNotes: typeof release.body === "string" ? release.body : "",
      releaseDate: typeof release.published_at === "string" ? release.published_at : "",
      zcodeReleaseChannel: channel,
    } as UpdateInfo;
  }
}

function personalTargetFiles(version: string, platform: string): string[] {
  const targets: Record<string, [string, string[]]> = {
    "windows-x86_64": ["win", ["x64.exe"]],
    "darwin-x86_64": ["mac", ["x64.zip", "x64.dmg"]],
    "darwin-aarch64": ["mac", ["arm64.zip", "arm64.dmg"]],
    "linux-x86_64": ["linux", ["x86_64.AppImage", "amd64.deb", "x86_64.rpm", "x64.pkg.tar.zst"]],
    "linux-aarch64": [
      "linux",
      ["arm64.AppImage", "arm64.deb", "aarch64.rpm", "aarch64.pkg.tar.zst"],
    ],
  };
  const target = targets[platform];
  if (!target) throw new Error(`Unsupported Personal update platform: ${platform}`);
  return target[1].map((suffix) => `ZCode-Personal-${version}-${target[0]}-${suffix}`);
}
