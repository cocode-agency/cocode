import net from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { CompanionTransport } from "./transport.js";
import {
  registerUserQuestionProvider,
  TuiCompanionGateway,
  type ApprovalRequest,
  type UserQuestionsService,
} from "./gateway.js";
import type { Agent, RuntimeContext } from "./types.js";

export { TuiCompanionGateway } from "./gateway.js";
export { CompanionTransport } from "./transport.js";

export const name = "cocode-host-jsonrpc";
export const inject = ["agents"];

export function apply(
  ctx: RuntimeContext,
  config: { endpoint: string; protocolRevision?: string } = { endpoint: "" },
): void {
  if (!config.endpoint)
    throw new Error("cocode-host-jsonrpc requires an endpoint");
  const clients = new Set<TuiCompanionGateway>();
  let questionDisposer: (() => void) | undefined;
  let approvalDisposer: (() => void) | undefined;
  let disposed = false;
  const registerQuestionProvider = (): void => {
    if (questionDisposer !== undefined) return;
    const service = ctx.get("userQuestions") as
      | UserQuestionsService
      | undefined;
    if (service === undefined) return;
    questionDisposer = registerUserQuestionProvider(
      service,
      async (request) => {
        const owner = resolveQuestionOwner(clients, request.agent);
        if (owner === undefined)
          throw new Error("no connected TUI owns the question request");
        return owner.askQuestion(request);
      },
    );
  };
  const registerApprovalRouter = (): void => {
    if (approvalDisposer !== undefined) return;
    if (ctx.get("approval") === undefined) return;
    approvalDisposer = ctx.on(
      "approval/request",
      ((request: ApprovalRequest, next: () => Promise<string>) => {
        const owner = resolveQuestionOwner(clients, request.agent);
        if (owner === undefined) return next();
        return owner.askApproval(request);
      }) as (...args: never[]) => unknown,
      true,
    );
  };
  const server = net.createServer((socket) => {
    let authenticated = false;
    let buffer = "";
    const transport = new CompanionTransport(socket, socket);
    const gateway = new TuiCompanionGateway(ctx, transport, {
      registerQuestionProvider: false,
    });
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const first = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let frame: {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      try {
        frame = JSON.parse(first);
      } catch {
        socket.destroy();
        return;
      }
      if (
        frame.method !== "cocode/host/connect" ||
        typeof frame.id !== "number"
      ) {
        socket.destroy();
        return;
      }
      authenticated = true;
      clients.add(gateway);
      registerQuestionProvider();
      registerApprovalRouter();
      socket.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { protocolRevision: config.protocolRevision ?? "1.0", capabilities: ["session", "event", "workspace"] } })}\n`,
      );
      socket.off("data", onData);
      if (buffer) socket.emit("data", Buffer.from(buffer));
      transport.start();
    };
    socket.on("data", onData);
    socket.once("close", () => {
      clients.delete(gateway);
      void gateway.disconnect().catch(() => undefined);
      transport.close();
      if (clients.size === 0) {
        questionDisposer?.();
        questionDisposer = undefined;
        approvalDisposer?.();
        approvalDisposer = undefined;
      }
    });
    transport.onRequest(async (method, params) =>
      gateway.handleRequest(method, params),
    );
  });
  const startServer = (): void => {
    if (disposed || server.listening) return;
    if (process.platform !== "win32" && existsSync(config.endpoint))
      unlinkSync(config.endpoint);
    server.listen(config.endpoint);
    if (process.platform !== "win32") {
      try {
        chmodSync(config.endpoint, 0o600);
      } catch {}
    }
  };
  const loader = ctx.get("loader") as { await?: () => Promise<unknown> } | undefined;
  if (loader?.await === undefined) {
    startServer();
  } else {
    void loader.await().then(
      () => startServer(),
      () => undefined,
    );
  }
  ctx.effect?.(
    () => async () => {
      disposed = true;
      questionDisposer?.();
      questionDisposer = undefined;
      approvalDisposer?.();
      approvalDisposer = undefined;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    "cocode-host-jsonrpc.serve",
  );
}

function resolveQuestionOwner(
  clients: ReadonlySet<TuiCompanionGateway>,
  agent: Agent | undefined,
): TuiCompanionGateway | undefined {
  if (agent !== undefined) {
    const owners = [...clients].filter((client) => client.ownsAgent(agent));
    return owners.length === 1 ? owners[0] : undefined;
  }
  return clients.size === 1 ? clients.values().next().value : undefined;
}
