import { createConnection } from "node:net";
import { AutomationError } from "./validation.js";

export const MAX_WIRE_BYTES = 12 * 1024 * 1024;
export function connectLease(socketPath, credentials, onLost) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    let buffer = "";
    let ready = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new AutomationError("timeout", "Broker lease handshake timed out"));
    }, 10000);
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ ...credentials, method: "lease" })}\n`),
    );
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 4096) socket.destroy();
      if (!buffer.includes("\n") || ready) return;
      clearTimeout(timer);
      try {
        const result = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        if (result.isError) throw new AutomationError("not_authorized", "Broker lease rejected");
        ready = true;
        resolve(socket);
      } catch (error) {
        reject(error);
        socket.destroy();
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      reject(new AutomationError("broker_unavailable", "Broker lease unavailable"));
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (ready) onLost();
      else reject(new AutomationError("broker_unavailable", "Broker lease closed"));
    });
  });
}
export function exchange(socketPath, payload, signal, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AutomationError("CONTROL_STOPPED", "Call cancelled"));
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    let sent = false;
    let buffer = "";
    const finish = (error, value) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () =>
      finish(
        new AutomationError("CONTROL_STOPPED", "Call cancelled; observe before retrying", sent),
      );
    const timer = setTimeout(
      () =>
        finish(
          new AutomationError("timeout", "Computer Use timed out; request was not replayed", sent),
        ),
      timeoutMs,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    // Windows named pipe 不支持 TCP 式半关闭；end 会在原生请求完成前关闭回包通道。
    socket.on("connect", () => {
      sent = true;
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_WIRE_BYTES)
        return finish(new AutomationError("internal", "Computer Use response exceeds limit", sent));
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        finish(null, JSON.parse(buffer.slice(0, end)));
      } catch {
        finish(new AutomationError("internal", "Invalid broker response", sent));
      }
    });
    socket.on("error", () =>
      finish(
        new AutomationError("broker_unavailable", "Windows Computer Use broker disconnected", sent),
      ),
    );
    socket.on("end", () => {
      if (!buffer.includes("\n"))
        finish(new AutomationError("broker_unavailable", "Broker closed without a receipt", sent));
    });
  });
}
