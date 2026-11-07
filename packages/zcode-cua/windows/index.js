import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { createWindowsBackend } from "./worker.js";
import { exchange, connectLease } from "./transport.js";
import {
  AutomationError,
  errorResult,
  isRecord,
  ownerKey,
  resultEnvelope,
  validateCall,
} from "./validation.js";
export { parseFrame, framePair, rasterIdentity, attestFrame, preserveFrame } from "./frame.js";

export function createBrokerRuntime(options = {}) {
  const clientId = randomUUID();
  const authority = (options.env ?? process.env).ZCODE_CUA_PLUGIN_AUTHORITY;
  const owners = new Map();
  let disposed = false;
  let lease;
  let leasePromise;
  let leaseLost = false;
  const ensureLease = async () => {
    if (leaseLost)
      throw new AutomationError("CONTROL_STOPPED", "Broker lease was lost; start a new session");
    leasePromise ??= connectLease(options.brokerSocketPath, { clientId, authority }, () => {
      leaseLost = true;
    });
    lease = await leasePromise;
  };
  const call = (payload, signal) =>
    exchange(options.brokerSocketPath, { ...payload, clientId, authority }, signal);
  return {
    async execute(input) {
      try {
        if (disposed) throw new AutomationError("CONTROL_STOPPED", "Runtime closed");
        const args = validateCall(input.toolName, input.arguments);
        const owner = ownerKey(clientId, input.context);
        if (input.signal?.aborted) throw new AutomationError("CONTROL_STOPPED", "Call cancelled");
        if (!options.brokerSocketPath || !authority)
          throw new AutomationError("not_authorized", "Missing trusted broker credentials");
        await ensureLease();
        if (disposed || input.signal?.aborted)
          throw new AutomationError("CONTROL_STOPPED", "Call cancelled");
        owners.set(owner, input.context);
        return await call({ method: input.toolName, args, context: input.context }, input.signal);
      } catch (error) {
        return errorResult(error);
      }
    },
    async closeSession(context) {
      const owner = ownerKey(clientId, context);
      if (!owners.delete(owner)) return;
      await call({ method: "close_session", args: {}, context }).catch(() => undefined);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await Promise.all(
        [...owners.values()].map((context) =>
          call({ method: "close_session", args: {}, context }).catch(() => undefined),
        ),
      );
      owners.clear();
      await leasePromise?.catch(() => undefined);
      lease?.destroy();
    },
  };
}

export function createWindowsHost(options = {}) {
  const platform = options.platform ?? process.platform;
  const socketPath = `\\\\.\\pipe\\zcode-open-cua-${randomUUID()}`;
  const pluginAuthority = randomUUID();
  const backend = options.backend ?? createWindowsBackend(options);
  const stoppedOwners = new Set();
  const sockets = new Set();
  const clients = new Map();
  let closed = false;
  let starting;
  let server;
  let tail = Promise.resolve();
  const handle = { socketPath, pluginAuthority, pid: process.pid, bundleId: null };
  async function processRequest(request, signal) {
    if (!isRecord(request) || request.authority !== pluginAuthority)
      throw new AutomationError("not_authorized", "Invalid broker authority");
    const owner = ownerKey(request.clientId, request.context);
    const client = clients.get(request.clientId);
    if (!client) throw new AutomationError("not_authorized", "No live runtime lease");
    client.owners.add(owner);
    if (closed || signal.aborted)
      throw new AutomationError("CONTROL_STOPPED", "Host or call closed");
    if (request.method === "close_session" || request.method === "stop_computer_control") {
      stoppedOwners.add(owner);
      await backend.call({ method: "release", args: {}, owner }, signal);
      return resultEnvelope({ stopped: true });
    }
    if (stoppedOwners.has(owner))
      throw new AutomationError("CONTROL_STOPPED", "Computer control stopped for this session");
    const args = validateCall(request.method, request.args);
    const result = await backend.call({ method: request.method, args, owner }, signal);
    if (result.error?.code === "CONTROL_STOPPED") {
      stoppedOwners.add(owner);
      await backend.call({ method: "release", args: {}, owner });
    }
    return resultEnvelope(result);
  }
  const host = {
    get running() {
      return server?.listening === true;
    },
    get socketPath() {
      return host.running ? socketPath : null;
    },
    get pluginAuthority() {
      return host.running ? pluginAuthority : null;
    },
    get reservedTransport() {
      return closed ? undefined : handle;
    },
    async start() {
      if (closed) throw new AutomationError("CONTROL_STOPPED", "Host is closed");
      if (platform !== "win32")
        throw new AutomationError(
          "broker_unavailable",
          "Open-source Computer Use requires Windows",
        );
      if (starting) return starting;
      starting = new Promise((resolve, reject) => {
        server = createServer({ allowHalfOpen: true }, (socket) => {
          sockets.add(socket);
          socket.setEncoding("utf8");
          const abort = new AbortController();
          let received = false;
          let buffer = "";
          socket.setTimeout(35000, () => socket.destroy());
          // allowHalfOpen 的 pipe 收到 EOF 后不会自行 close；租约 EOF 必须立即释放 owner。
          socket.on("end", () => socket.destroy());
          socket.on("error", () => abort.abort());
          socket.on("close", () => {
            sockets.delete(socket);
            abort.abort();
            for (const [id, client] of clients) {
              if (client.socket !== socket) continue;
              clients.delete(id);
              // 租约连接的断开是进程退出证据；不依赖超时猜测 owner 是否还活着。
              for (const owner of client.owners) {
                stoppedOwners.add(owner);
                tail = tail.then(() =>
                  backend.call({ method: "release", args: {}, owner }).catch(() => undefined),
                );
              }
            }
          });
          socket.on("data", (chunk) => {
            if (received) return;
            buffer += chunk.toString("utf8");
            if (Buffer.byteLength(buffer) > 128 * 1024) {
              socket.destroy();
              return;
            }
            const end = buffer.indexOf("\n");
            if (end < 0) return;
            received = true;
            const run = async () => {
              let result;
              try {
                const request = JSON.parse(buffer.slice(0, end));
                if (request.method === "lease") {
                  if (
                    closed ||
                    abort.signal.aborted ||
                    request.authority !== pluginAuthority ||
                    typeof request.clientId !== "string" ||
                    clients.has(request.clientId)
                  )
                    throw new AutomationError("not_authorized", "Invalid runtime lease");
                  clients.set(request.clientId, { socket, owners: new Set() });
                  socket.setTimeout(0);
                  socket.write(`${JSON.stringify(resultEnvelope({ connected: true }))}\n`);
                  return;
                }
                result = await processRequest(request, abort.signal);
              } catch (error) {
                result = errorResult(error);
              }
              if (!socket.destroyed) socket.end(`${JSON.stringify(result)}\n`);
            };
            tail = tail.then(run, run);
          });
        });
        server.once("error", reject);
        server.listen(socketPath, () => resolve(handle));
      });
      return starting;
    },
    async waitForTransport() {
      return host.start();
    },
    async checkHealth() {
      await host.start();
      return { pid: process.pid, bundleId: null };
    },
    async stop() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await starting?.catch(() => undefined);
      await backend.dispose();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await tail;
    },
    async restart() {
      throw new AutomationError(
        "action_unavailable",
        "Restart ZCode to replace a stopped Windows control host",
      );
    },
    async restartAfterCurrentStart() {
      return host.restart();
    },
    async queryScreenCaptureProbe() {
      return { ok: false, reason: "Capture requires a selected foreground window" };
    },
    async queryScreenRecordingPreflight() {
      return undefined;
    },
    async queryPermissionStatus() {
      return { grant_owner: "ZCode", accessibility: "unknown", screen_recording: "unknown" };
    },
  };
  return host;
}
