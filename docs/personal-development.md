# 个人适配开发与官方同步

本 fork 在官方 ZCode 基础上维护个人适配，并持续合并官方更新。

## 远端与分支

| 名称                          | 用途                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `upstream`                    | 官方仓库 `https://github.com/zai-org/ZCode`                   |
| `origin`                      | 个人 fork `https://github.com/xiaobaoaaaaaa/ZCode`            |
| `main`                        | 官方基线镜像，只接受官方提交的快进更新                        |
| `personal`                    | 个人适配集成分支，跟踪 `origin/personal`                      |
| `feat/<topic>`、`fix/<topic>` | 从 `personal` 创建的短期功能、修复分支，完成后合入 `personal` |

个人改动不直接提交到 `main`。已发布的 `personal` 通过 merge 接收官方更新，保留提交历史；不对它执行 rebase 或强制推送。个人功能采用小而独立的提交，便于逐项定位冲突、回退或向官方贡献。

当前 checkout 使用以下仓库级配置。重新克隆时需要重新设置，它们不会随提交传播：

```sh
git config --local remote.pushDefault origin
git config --local push.default simple
git config --local pull.ff only
gh repo set-default xiaobaoaaaaaa/ZCode
```

`git push` 默认推送至个人 fork；`git pull` 只允许快进，官方更新使用下面的显式 merge 流程。个人功能 PR 的目标为 `xiaobaoaaaaaa/ZCode` 的 `personal` 分支，创建 PR 时显式指定目标仓库和分支。

## 同步官方更新

逐步执行，任一步失败即停止。开始前运行 `git status --short`，确认工作区干净；已有改动应先在所属分支提交或由开发者自行保存。

```sh
git fetch origin --prune
git fetch upstream --prune

git switch main
git merge --ff-only origin/main
git merge --ff-only upstream/main
git rev-list --left-right --count main...upstream/main
```

最后一条应输出 `0 0`。否则先调查差异，不通过 reset 或强推覆盖分支。确认一致后更新 fork 的基线，并将官方更新合入个人分支：

```sh
git push origin main
git switch personal
git merge --ff-only origin/personal
git merge --no-edit upstream/main
```

若发生冲突，逐项检查官方行为与个人适配，解决后提交合并；不能整体选择 ours/theirs 覆盖一方。需要取消这次尚未完成的合并时使用 `git merge --abort`。

按 `mise.toml` 准备开发工具并安装依赖后执行验证，全部必要检查通过后再推送：

```sh
node scripts/check-workspace-freshness.mjs
git diff --check
pnpm typecheck
pnpm lint
pnpm verify:pre-push
git push origin personal
```

新鲜度脚本获取并检查 `origin`，不会自行获取官方 `upstream`，因此不能省略前面的官方 fetch。合并更新后，还应按受影响模块执行必要的运行时或 UI 验证；具体要求遵循 [AGENTS.md](../AGENTS.md)。

## 开发个人功能

Personal 构建需设置 `ZCODE_PERSONAL_IDENTITY=1`；该开关与后端环境独立，不能与 Preview 身份同时开启。例如 `ZCODE_PERSONAL_IDENTITY=1 pnpm dev:desktop`。发布工作流已固定开启；未开启时保留官方构建路径，便于同步和对比，不能作为 Personal 安装包发布。具体数据与系统入口规则见 [独立版规格](desktop/personal-edition.md)。

从已同步的 `personal` 创建功能分支，例如：

```sh
git switch personal
git pull --ff-only
git switch -c feat/my-adaptation
```

遵守官方的 spec、架构和测试约定；新增或修改行为前先更新对应 spec，再实现和验证。个人功能尽量使用现有扩展点、配置与平台接口，减少对共享核心的侵入，降低后续同步成本。

完成后按相关文件分批暂存并创建独立提交。首次推送新功能分支时，显式指定受影响测试的基线：

```sh
ZCODE_AFFECTED_TEST_BASE=personal git push -u origin HEAD
```

原因：当前官方 pre-push 对新分支默认查找 `origin/staging`，本 fork 没有该分支。显式基线不跳过检查。首次发布 `personal` 时使用 `ZCODE_AFFECTED_TEST_BASE=upstream/main`；已有远端分支的后续推送使用其远端提交作为基线。详见 [pre-push 说明](testing/pre-push-hook.md)。

功能通过验证后合入 `personal`，再推送 `origin/personal`。本流程由开发任务按需执行，不代表已配置定时同步。
