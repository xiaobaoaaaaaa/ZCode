import { createBrokerRuntime } from "./windows/index.js";
const UNAVAILABLE_TEXT =
  "Computer Use requires the Windows desktop app and an enabled Computer Use plugin.";

export function createComputerUseRuntime(options) {
  if (options?.brokerSocketPath) return createBrokerRuntime(options);
  return {
    async execute() {
      return {
        content: [{ type: "text", text: UNAVAILABLE_TEXT }],
        isError: true,
      };
    },
    async closeSession() {},
    async dispose() {},
  };
}
