# 本轮性能协议

提供请求事实、turn 汇总的严格 schema 与纯聚合函数。没有 IO、计时器或共享可变状态。
ProductProjection 是聚合及去重唯一所有者。inputTokens 已含缓存；部分未知的 token
合计为 null，时序仅聚合有效样本并记录覆盖请求数。跨进程字段 optional，旧记录不回填。
产品及恢复合同见 docs/ui/turn-performance-summary.md。
