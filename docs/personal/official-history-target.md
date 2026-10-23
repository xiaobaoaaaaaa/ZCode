# 官方安全文本会话导入目标端

目标复用 session store 和 taskIndex，不复制官方数据库。新增 session/importHistory 是纯持久化命令，不创建运行时、不启动模型/MCP、不重放工具。只接收有界 user/assistant 文本与来源hash；旧权限、执行队列、自动化、reasoning/tool part、旧项目ID均不进入目标。

SessionStore 是历史唯一写者：sourceKey 的全局 provenance 主键与派生新session ID共同去重；消息/part使用新命名空间，assistant parent只指向此前导入user。begin immediate 同步事务内创建session、全部message/part、provenance，异常全部回滚。重复来源返回已有session，禁止改绑项目或覆盖已续聊/已删历史。

Host按本机目录关联项目，拒绝远程workspace身份及不存在目录。CLI事务成功后写taskIndex CLI事实；两库不伪称跨库原子。索引失败可重试同sourceKey，CLI去重返回同session，索引幂等修复；中途失败不得删除已导入可恢复正文。再次打开/显式发送新消息才启动运行时。用户界面须说明只有安全文本，原工具上下文及外部副作用未迁移。

验证仅用临时profile及合成SQLite：ID/FK、同源重复、不同source映射、跨目录拒绝、写入失败回滚、索引失败后重试。不得读取真实profile。

已验证：合成 SQLite 原子插入/失败回滚/FK/重复/目标正文改动拒绝（2 测试），协议导入不构建 app/model/MCP 以及 SQLite 历史 resume 后只在显式新输入时进入模型请求（4 测试），索引失败重试及用户后续改名/项目归属保留（1 测试）。shared/services、bootstrap 类型检查通过，architecture --changed 零违规。Windows 与整体设置页验收由集成流程单独完成；Linux 单测不等同 Windows 验收。
