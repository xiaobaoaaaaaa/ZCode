# 本轮性能展示

入口 TurnPerformanceSummary 只接收 turnId、CLI performance 和 running。
无数据不显示，未知值为 —；运行中标明已完成请求，桌面展示速度与平均首响应，
窄屏保留速度并通过 Popover 读取完整值。仅拥有浮层开关，无服务、计时和持久状态。
调用方负责只在 product turn 渲染一次；数据规则见 docs/ui/turn-performance-summary.md。
