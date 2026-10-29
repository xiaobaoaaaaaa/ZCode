# data-import

Main 持有一个 `createDataImporter` 实例，串行接纳本机目录导入。`importDirectory` 返回时新副本和启动选择已持久化；执行中重复请求返回 busy。失败时旧启动选择不变，本次副本移除。输入源只读，完整树变更检测与 SQLite 检查在副本执行。

`readImportedProfile` 只在进程启动时读取启动选择；`applyImportedProfileEnvironment` 设置应用专用路径，不改变 HOME/USERPROFILE。设置服务继续管理副本 setting.json。启动选择存放于初始 desktop home，不能随 profile 漂移。

公开接口：index.ts 的文件适配器与 contract.ts 的类型。依赖 shared 平台 DTO，不依赖 Runtime 或 Electron。顺序见 docs/desktop/import-zcode-directory.md。
