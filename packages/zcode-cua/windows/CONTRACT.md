# cua-windows-open

Windows 开源执行后端。产品规则见 docs/desktop/opensource-windows-computer-use.md。
Host 独占 pipe、authority 和串行 admission；worker 独占原生元素与 OS 输入 mutex。
UI 不直接访问 worker。模型参数不能赋予会话权限。取消或丢失结果不重放动作。
stop 为 owner 终态，dispose 为 Host 终态；坐标绑定会话、窗口和几何，权限未知时拒绝。
只使用系统组件，JSON 输入与 native 源码分离，模型不能指定执行文件。
