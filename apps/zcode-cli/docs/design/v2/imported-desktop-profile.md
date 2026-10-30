# Desktop 导入副本的 CLI 路径

Desktop 从独立 ZCode 目录导入后，下一次启动选择一个完整副本。CLI 继续使用现有 `ZCODE_STORAGE_DIR`、`ZCODE_SESSION_DB_PATH`、`ZCODE_LOG_DIR` 配置覆盖存储、会话和日志位置，优先级不变。

新增 `ZCODE_PROFILE_BASE_DIR` 只由 Desktop 启动 bootstrap 根据成功导入的启动选择注入，值必须是已存在的绝对副本父路径。用途是把原本固定在 HOME 的用户 ZCode 配置发现（`~/.zcode/cli/config.json`、用户技能、命令、AGENTS.md、工作流）统一定位到 `<profile>/.zcode`。仅影响 ZCode 自有目录；HOME、USERPROFILE、项目级配置、`.agents` 兼容目录和普通 `~/...` 展开不变。未配置时保持现有路径与优先级；显式配置文件路径仍高于默认用户路径。

Desktop 在导入时校验完整目录、复制、校验 SQLite，并持久化启动选择。CLI 不迁移文件、不写启动选择、不产生第二份运行状态。不支持运行中热切换；旧 CLI 退出后，新的进程读取固定环境。无效启动选择由 Desktop 忽略，保持原始数据；CLI 不自动猜测替代目录。

验证包括用户配置/skills/commands/AGENTS 定位到副本，普通 HOME 展开和外部项目路径不变，App 索引与 CLI 会话正文在冷重启后同时可读。完整交互见 `docs/desktop/import-zcode-directory.md`。

## Personal 独立根

Personal Desktop 启动时还注入 `ZCODE_PROFILE_ROOT_DIR`，绝对路径直接指向 `~/.zcode-personal` 或导入副本的 `.zcode-personal`。该值优先于旧 `ZCODE_PROFILE_BASE_DIR/.zcode`，缺省继续沿用旧行为。CLI 的用户 config、skills、commands、AGENTS、工作流与遥测路径由此选择；项目 `.zcode` 和兼容 `.agents` 不变。显式配置文件参数仍优先。空值等同未配置，非绝对路径在环境配置解析时失败，不自动拼接 HOME。Desktop 同时下发既有 storage/session/log 环境变量，CLI 不根据产品名称猜路径。
