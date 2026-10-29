import { homedir } from "node:os";
import { applyImportedProfileEnvironment, readImportedProfile } from "./profile.js";

// 独立启动入口没有 services barrel 依赖，保证路径在模块级常量求值前确定。
const bootstrapHome = process.env.ZCODE_DESKTOP_HOME_DIR?.trim() || homedir();
const profile = readImportedProfile(bootstrapHome);
if (profile) applyImportedProfileEnvironment(profile);
