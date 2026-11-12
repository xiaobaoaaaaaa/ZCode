import { addTurnPerformance } from "./contract.js";
export const example = addTurnPerformance(undefined, {
  requestId: "assistant-example",
  durationMs: 4000,
  firstResponseMs: 1000,
  outputTokens: 150,
});
