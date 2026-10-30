import { homedir } from "node:os";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared/env";
import {
  applyImportedProfileEnvironment,
  applyPersonalDataEnvironment,
  readImportedProfile,
} from "./profile.js";

// 独立启动入口没有 services barrel 依赖，保证路径在模块级常量求值前确定。
const bootstrapHome = process.env.ZCODE_DESKTOP_HOME_DIR?.trim() || homedir();
if (ZCODE_PRODUCT_FLAVOR === "personal") {
  // 不允许 shell 中旧版本的 profile 覆盖 Personal 首次启动的空目录。
  delete process.env.ZCODE_PROFILE_BASE_DIR;
  applyPersonalDataEnvironment(bootstrapHome);
}
const profile = readImportedProfile(bootstrapHome);
if (profile) applyImportedProfileEnvironment(profile);
