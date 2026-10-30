# Settings Search

公开入口 contract.ts。createSettingsSearchIndex 从现有分区配置、平台能力和静态翻译构造索引；
searchSettings 是纯查询，不加载分区或服务。SettingsGlobalSearch 只拥有弹窗/query 状态，
onSelect 返回 section + anchor，由 SettingsPage 经既有导航路径提交。
useSettingsSearchDestination 在选定内容提交 DOM 后定位对应 anchor，缺失时定位分区标题，
关闭弹窗时禁止恢复旧触发器焦点覆盖选中目标；取消保持原焦点恢复。

不保存查询，不访问网络，不读写设置或用户数据；不新增 Host/RPC/全局 store。
平台条件与设置本体保持一致。规格与 SGS01–07 验收见 docs/ui/settings-global-search.md。
