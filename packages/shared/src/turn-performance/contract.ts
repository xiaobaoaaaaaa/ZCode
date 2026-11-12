import { z } from "zod";

const count = z.number().finite().nonnegative();
/** 成功主链路模型 step 的事实；requestId 是稳定的 assistantMessageId。 */
export const requestPerformanceSchema = z
  .object({
    requestId: z.string().min(1),
    durationMs: count.optional(),
    firstResponseMs: count.optional(),
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    reasoningTokens: count.optional(),
    cacheReadTokens: count.optional(),
    cacheWriteTokens: count.optional(),
  })
  .strict();
export type RequestPerformance = z.infer<typeof requestPerformanceSchema>;

export const turnPerformanceSchema = z
  .object({
    requestCount: count.int(),
    inputTokens: count.nullable(),
    outputTokens: count.nullable(),
    reasoningTokens: count.nullable(),
    cacheReadTokens: count.nullable(),
    cacheWriteTokens: count.nullable(),
    modelDurationMs: count.nullable(),
    firstResponseTotalMs: count,
    firstResponseCount: count.int(),
    generationDurationMs: count,
    timedOutputTokens: count,
    timedRequestCount: count.int(),
  })
  .strict();
export type TurnPerformance = z.infer<typeof turnPerformanceSchema>;

/** 只聚合事实；请求去重和 turn 归属由 ProductProjection 负责。 */
export function addTurnPerformance(
  previous: TurnPerformance | undefined,
  sample: RequestPerformance,
): TurnPerformance {
  const sum = (prior: number | null | undefined, value: number | undefined): number | null =>
    prior === null || value === undefined ? null : (prior ?? 0) + value;
  const first = sample.firstResponseMs;
  // 不把缺失首响应或零生成时长除成 Infinity，也不让只有 usage 的请求稀释速度。
  const generation =
    sample.durationMs !== undefined && first !== undefined && sample.durationMs > first
      ? sample.durationMs - first
      : null;
  const timed = generation !== null && sample.outputTokens !== undefined;
  return {
    requestCount: (previous?.requestCount ?? 0) + 1,
    inputTokens: sum(previous?.inputTokens, sample.inputTokens),
    outputTokens: sum(previous?.outputTokens, sample.outputTokens),
    reasoningTokens: sum(previous?.reasoningTokens, sample.reasoningTokens),
    cacheReadTokens: sum(previous?.cacheReadTokens, sample.cacheReadTokens),
    cacheWriteTokens: sum(previous?.cacheWriteTokens, sample.cacheWriteTokens),
    modelDurationMs: sum(previous?.modelDurationMs, sample.durationMs),
    firstResponseTotalMs: (previous?.firstResponseTotalMs ?? 0) + (first ?? 0),
    firstResponseCount: (previous?.firstResponseCount ?? 0) + (first !== undefined ? 1 : 0),
    generationDurationMs: (previous?.generationDurationMs ?? 0) + (timed ? generation : 0),
    timedOutputTokens: (previous?.timedOutputTokens ?? 0) + (timed ? sample.outputTokens! : 0),
    timedRequestCount: (previous?.timedRequestCount ?? 0) + (timed ? 1 : 0),
  };
}
