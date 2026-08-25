import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type { ToolDefinition } from "@deepseek-ai/dsh-tools"

export interface WorkbenchRequest {
  readonly method: string
  readonly url?: string
  readonly aborted?: boolean
  on?(event: "aborted", listener: () => void): unknown
  off?(event: "aborted", listener: () => void): unknown
  readonly [Symbol.asyncIterator]: () => AsyncIterator<Uint8Array | string>
}

export interface WorkbenchResponse {
  readonly destroyed?: boolean
  readonly writableEnded?: boolean
  on?(event: "close", listener: () => void): unknown
  off?(event: "close", listener: () => void): unknown
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

export interface WorkbenchRoute {
  /** `exact` 逐字匹配路径，`prefix` 还匹配其下的所有子路径。 */
  readonly kind: "exact" | "prefix"
  readonly path: string
  readonly handler: (request: WorkbenchRequest, response: WorkbenchResponse) => Promise<void>
}

/** WebSocket upgrade registration, used by the browser frame channel. */
export interface WorkbenchUpgradeRoute {
  readonly path: string
  readonly handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
}

/** Tool runtime; browser tools register through it when it is mounted. */
export interface WorkbenchTools {
  register(definition: ToolDefinition): () => void
}

/** Durable attachment store; enables agent screenshots when it is mounted. */
export interface WorkbenchAttachments {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<{
    attachmentId: string
    mediaType: string
    width: number
    height: number
  }>
}

/** File-effect mode of the harness sandbox; the workbench mirrors it for writes. */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"

/** One live session, passed back to the sandbox policy for its mode override. */
export interface WorkbenchSession {
  readonly header?: { readonly cwd?: string }
}

/**
 * Sandbox policy home; resolves the file-effect mode of one session. Optional,
 * so the workbench still runs in a composition without the sandbox stack.
 */
export interface WorkbenchSandboxPolicy {
  resolve(request: { readonly session?: WorkbenchSession }): { readonly mode: SandboxMode }
}

/** User settings document; carries the commit-message model choice. */
export interface WorkbenchSettingsService {
  register(namespace: string, schema: unknown): unknown
  describe(options?: { readonly redactSecrets?: boolean }): readonly {
    readonly ns: string
    readonly value: unknown
    readonly revision: number
  }[]
  update(namespace: string, patch: unknown, expectedRevision?: number): Promise<unknown>
  readonly writable: boolean
}

export interface WorkbenchContext {
  readonly sessions: { get(id: string): WorkbenchSession | undefined }
  readonly webServer: {
    register(route: WorkbenchRoute): () => void
    registerUpgrade(route: WorkbenchUpgradeRoute): () => void
    readonly host?: string
    readonly port?: number
  }
  /**
   * Read a service the plugin does not inject. Everything the workbench cannot
   * run without is injected and typed above; these are enhancements, and
   * injecting them would keep the whole plugin pending in a host that mounts
   * none of them.
   */
  get(name: "tools"): WorkbenchTools | undefined
  get(name: "attachments"): WorkbenchAttachments | undefined
  get(name: "llm"): import("@deepseek-ai/dsh-llm").LlmRuntime | undefined
  get(name: "settings"): WorkbenchSettingsService | undefined
  get(name: "sandboxPolicy"): WorkbenchSandboxPolicy | undefined
  /** Run once the optional service is mounted; used to register the settings schema. */
  inject(
    deps: readonly ["settings"],
    callback: (ctx: WorkbenchContext & { readonly settings: WorkbenchSettingsService }) => void | (() => void),
  ): void
  effect(effect: () => void | (() => void), label?: string): void
}
