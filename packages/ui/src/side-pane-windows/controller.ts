import type { SidePaneWindowHandle } from "@zcode/shared";
import type { SidePaneWindowPhase, SidePaneWindowPorts } from "./contract.js";

export function createSidePaneWindowController(ports: SidePaneWindowPorts) {
  let phase: SidePaneWindowPhase = "docked";
  let handle: SidePaneWindowHandle | undefined;
  let wanted = false;
  let disposed = false;
  let generation = 0;
  let flight: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SidePaneWindowPhase) => {
    if (phase === next) return;
    phase = next;
    for (const listener of listeners) listener();
  };
  const ready = () => ports.prepareMove?.() ?? Promise.resolve(true);
  const drive = async () => {
    const epoch = generation;
    try {
      while (!disposed && epoch === generation && wanted !== Boolean(handle)) {
        if (wanted) {
          publish("opening");
          const opened = await ports.open(() => {
            void request(false);
          });
          // 关闭/卸载可以先于窗口创建完成；晚到结果只能清理，不能复活标签。
          if (disposed || epoch !== generation || !wanted) {
            opened.close();
            if (epoch === generation) publish("docked");
            continue;
          }
          try {
            if (!(await ready()) || disposed || epoch !== generation || !wanted) {
              opened.close();
              if (epoch === generation) {
                wanted = false;
                publish("docked");
              }
              continue;
            }
            await ports.moveToWindow(opened);
            if (disposed || epoch !== generation) {
              opened.close();
              return;
            }
            handle = opened;
            publish("detached");
          } catch (error) {
            opened.close();
            throw error;
          }
        } else if (handle) {
          publish("docking");
          if (!(await ready())) {
            wanted = true;
            publish("detached");
            return;
          }
          if (disposed || epoch !== generation) return;
          await ports.moveToDock();
          if (disposed || epoch !== generation) return;
          handle.close();
          handle = undefined;
          publish("docked");
          ports.onDocked();
        }
      }
    } catch (error) {
      if (disposed || epoch !== generation) return;
      wanted = Boolean(handle);
      publish(handle ? "detached" : "docked");
      ports.onError(error);
    }
  };
  const request = (detach: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    wanted = detach;
    if (detach && handle && phase === "detached") handle.focus();
    if (!flight) {
      const pending = drive().finally(() => {
        if (flight !== pending) return;
        flight = undefined;
        if (!disposed && wanted !== Boolean(handle)) void request(wanted);
      });
      flight = pending;
    }
    return flight;
  };
  return {
    connect() {
      disposed = false;
    },
    detach: () => request(true),
    dock: () => request(false),
    focus: () => handle?.focus(),
    setTitle: (title: string) => handle?.setTitle(title),
    getSnapshot: () => phase,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      generation += 1;
      flight = undefined;
      wanted = false;
      if (handle) {
        const closing = handle;
        handle = undefined;
        // 原生收回可能晚于组件卸载或主窗口销毁；仍消费 ACK/失败，避免悬空 rejection。
        try {
          const completion = ports.moveToDock();
          if (completion) {
            void completion.then(
              () => closing.close(),
              (error: unknown) => {
                closing.close();
                ports.onError(error);
              },
            );
          } else closing.close();
        } catch (error) {
          closing.close();
          ports.onError(error);
        }
      }
      publish("docked");
      listeners.clear();
    },
  };
}
