# 本轮性能摘要投影

产品规则、事件顺序与验收以 [本轮性能摘要](../../../../../docs/ui/turn-performance-summary.md) 为准。

Runtime 将成功主链路模型 step 的 requestId、usage 和 adapter 完成时序组成
`requestPerformance`，绑定 assistantMessageId。metadata 与 ModelComplete 使用相同值。
ProductProjection 在 turnHeader.performance 聚合；hydration 从活动 transcript 合成相同事实。
旧 metadata 缺失时不推算首响或生成速度；不迁移数据库，不读取调试旁路为业务真值。
