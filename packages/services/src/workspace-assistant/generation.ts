import { Emitter, type Event } from "@zcode/rpc";
import type { AssistantGeneration, AssistantScope } from "./contract.js";

export type GenerationProgress = Pick<AssistantGeneration, "text" | "reasoning" | "toolActivity">;
export type UpdateGeneration = (value: GenerationProgress) => void;

// 逐个识别顶层字段，仅解码已经收到的合法 JSON 字符串前缀；嵌入正文的引号或 kind 字样不能改变路由类别。
function readString(source: string, start: number) {
  if (source[start] !== '"') return;
  let end = start + 1;
  while (end < source.length) {
    const ch = source[end]!;
    if (ch === '"')
      return {
        value: JSON.parse(source.slice(start, end + 1)) as string,
        next: end + 1,
        complete: true,
      };
    if (ch === "\\") {
      const escape = source[end + 1];
      if (!escape || (escape === "u" && end + 6 > source.length)) break;
      end += escape === "u" ? 6 : 2;
    } else end++;
  }
  const value = JSON.parse(source.slice(start, end) + '"') as string;
  return { value: value.replace(/[\uD800-\uDBFF]$/u, ""), next: end, complete: false };
}
export function routerProgress(source: string, kinds: readonly string[]) {
  let body = source.trimStart().replace(/^`{3}(?:json)?\s*/i, "");
  if (!body.startsWith("{")) return "";
  body = body.slice(1).trimStart();
  let kind = "",
    text = "";
  try {
    while (body) {
      const key = readString(body, 0);
      if (!key?.complete) break;
      body = body.slice(key.next).trimStart();
      if (body[0] !== ":") break;
      body = body.slice(1).trimStart();
      if (body[0] === "[") {
        // 唯一数组字段是澄清候选 ID；其元素皆为 JSON 字符串，可以位于 text 之前。
        const array = body.match(/^\[\s*(?:(?:"(?:[^"\\]|\\.)*"\s*,\s*)*"(?:[^"\\]|\\.)*"\s*)?\]/);
        if (key.value !== "choices" || !array) break;
        body = body.slice(array[0].length).trimStart();
      } else {
        const val = readString(body, 0);
        if (!val) break;
        if (key.value === "kind" && val.complete) kind = val.value;
        if (key.value === "text") text = val.value;
        if (!val.complete) break;
        body = body.slice(val.next).trimStart();
      }
      if (body[0] !== ",") break;
      body = body.slice(1).trimStart();
    }
    return kinds.includes(kind) ? text : "";
  } catch {
    return "";
  }
}
export function createAssistantGenerations() {
  const entries = new Map<string, Map<string, AssistantGeneration>>();
  const listeners = new Map<string, Emitter<AssistantGeneration[]>>();
  const keyOf = (s: AssistantScope) => s.workspaceIdentity?.trim() || s.workspacePath;
  const snapshot = (key: string) => [...(entries.get(key)?.values() ?? [])];
  let disposed = false;
  return {
    listen(scope: AssistantScope): Event<AssistantGeneration[]> {
      const key = keyOf(scope);
      return (listener) => {
        let emitter = listeners.get(key);
        if (!emitter) {
          emitter = new Emitter({ onDidRemoveLastListener: () => listeners.delete(key) });
          listeners.set(key, emitter);
        }
        const sub = emitter.event(listener);
        listener(snapshot(key));
        return sub;
      };
    },
    async run<T>(
      scope: AssistantScope,
      meta: Omit<AssistantGeneration, "text" | "reasoning" | "toolActivity">,
      work: (update: UpdateGeneration) => Promise<T>,
    ): Promise<T> {
      const key = keyOf(scope);
      let closed = false;
      try {
        return await work((progress) => {
          if (disposed || closed) return;
          const previous = entries.get(key)?.get(meta.id);
          if (
            (!previous && !progress.text && !progress.reasoning && !progress.toolActivity) ||
            (previous?.text === progress.text &&
              previous.reasoning === progress.reasoning &&
              previous.toolActivity?.name === progress.toolActivity?.name &&
              previous.toolActivity?.status === progress.toolActivity?.status)
          )
            return;
          const pending = entries.get(key) ?? new Map<string, AssistantGeneration>();
          pending.set(meta.id, { ...meta, ...progress });
          entries.set(key, pending);
          listeners.get(key)?.fire(snapshot(key));
        });
      } finally {
        closed = true;
        const pending = entries.get(key);
        if (pending?.delete(meta.id)) {
          if (!pending.size) entries.delete(key);
          listeners.get(key)?.fire(snapshot(key));
        }
      }
    },
    dispose() {
      disposed = true;
      entries.clear();
      for (const emitter of listeners.values()) {
        emitter.fire([]);
        emitter.dispose();
      }
      listeners.clear();
    },
  };
}
