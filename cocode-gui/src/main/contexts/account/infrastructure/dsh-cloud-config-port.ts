import { randomUUID } from "node:crypto"
import type { DshRuntimeProcess } from "../../dsh-runtime/infrastructure/dsh-runtime-process"

type RpcResult<T> =
	| { readonly ok: true; readonly value?: T }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type RpcEnvelope<T> = {
	readonly type: "server-response"
	readonly rpcId: string
	readonly result: RpcResult<T>
}

export type SettingsNamespace = {
	readonly ns: string
	readonly value: unknown
	readonly revision: number
}

/** Settings namespace holding the default model for new Agents. */
export const DEFAULT_MODEL_NAMESPACE = "agent-default-model"

export type ProviderView = {
	readonly provider: string
	readonly displayName: string
	readonly settingsNs: string
	readonly settingsPath: string[]
	readonly active: boolean
}

export type ModelGroup = {
	readonly id: string
	readonly name: string
	readonly models: readonly { readonly id: string; readonly name: string }[]
}

export type DefaultSelection = {
	readonly provider: string
	readonly model: string
	readonly reasoningEffort?: string
}

export type SessionModelTarget = {
	readonly sessionId: string
	readonly blank: boolean
	readonly running: boolean
}

export class DshCloudConfigUnavailableError extends Error {
	constructor(message = "DSH configuration service is unavailable") {
		super(message)
		this.name = "DshCloudConfigUnavailableError"
	}
}

export class DshCloudConfigPort {
	constructor(private readonly runtime: DshRuntimeProcess) {}

	async describeSettings(): Promise<{
		readonly writable: boolean
		readonly namespaces: SettingsNamespace[]
	}> {
		const result = await this.call<{ writable?: boolean; namespaces?: SettingsNamespace[] }>(
			"settings/describe",
			{},
		)
		return {
			writable: result.writable === true,
			namespaces: Array.isArray(result.namespaces) ? result.namespaces : [],
		}
	}

	async describeCredentials(
		refs: readonly string[],
	): Promise<Record<string, { configured: boolean; writable: boolean }>> {
		const result = await this.call<
			Record<string, { configured?: boolean; writable?: boolean }>
		>("credentials/describe", { refs: [...refs] })
		const output: Record<string, { configured: boolean; writable: boolean }> = {}
		for (const ref of refs) {
			const value = result[ref]
			output[ref] = {
				configured: value?.configured === true,
				writable: value?.writable !== false,
			}
		}
		return output
	}

	async providers(): Promise<ProviderView[]> {
		const [registered, configurable] = await Promise.all([
			this.call<{ id?: string; name?: string }[]>("llm/listProviders", {}),
			this.call<
				{
					provider?: string
					displayName?: string
					settingsNs?: string
					settingsPath?: readonly string[]
				}[]
			>("llm/listConfigurableProviders", {}),
		])
		const active = new Set(
			(Array.isArray(registered) ? registered : [])
				.filter((provider) => typeof provider?.id === "string")
				.map((provider) => provider.id as string),
		)
		const declared = new Set<string>()
		const providers: ProviderView[] = []
		for (const provider of Array.isArray(configurable) ? configurable : []) {
			if (
				typeof provider?.provider !== "string" ||
				typeof provider.displayName !== "string" ||
				typeof provider.settingsNs !== "string" ||
				!Array.isArray(provider.settingsPath)
			)
				continue
			declared.add(provider.provider)
			providers.push({
				provider: provider.provider,
				displayName: provider.displayName,
				settingsNs: provider.settingsNs,
				settingsPath: [...provider.settingsPath],
				active: active.has(provider.provider),
			})
		}
		for (const provider of Array.isArray(registered) ? registered : []) {
			if (typeof provider?.id !== "string" || declared.has(provider.id)) continue
			providers.push({
				provider: provider.id,
				displayName: typeof provider.name === "string" ? provider.name : provider.id,
				settingsNs: "",
				settingsPath: [],
				active: true,
			})
		}
		return providers
	}

	async models(): Promise<ModelGroup[]> {
		const result = await this.call<{ groups?: ModelGroup[] }>("session/modelCatalog", {})
		return Array.isArray(result.groups) ? result.groups : []
	}

	async currentDefault(): Promise<DefaultSelection> {
		const settings = await this.describeSettings()
		const namespace = settings.namespaces.find((item) => item.ns === DEFAULT_MODEL_NAMESPACE)
		const value = namespace?.value
		if (typeof value !== "object" || value === null || Array.isArray(value))
			throw new Error("default model selection is unavailable")
		const record = value as Record<string, unknown>
		if (typeof record.provider !== "string" || typeof record.model !== "string")
			throw new Error("default model selection is unavailable")
		return {
			provider: record.provider,
			model: record.model,
			...(typeof record.reasoningEffort === "string"
				? { reasoningEffort: record.reasoningEffort }
				: {}),
		}
	}

	async mutateSettings(request: {
		readonly ns: string
		readonly expectedRevision?: number
		readonly ops: readonly {
			readonly op: "set" | "unset"
			readonly path: readonly string[]
			readonly value?: unknown
		}[]
	}): Promise<void> {
		await this.call("settings/mutate", request)
	}

	async setCredential(ref: string, value: string): Promise<void> {
		await this.call("credentials/set", { ref, value })
	}

	async unsetCredential(ref: string): Promise<void> {
		await this.call("credentials/unset", { ref })
	}

	async listSessions(): Promise<readonly SessionModelTarget[]> {
		const result = await this.call<{ items?: unknown }>("session/list", { _request: {} })
		if (!Array.isArray(result.items)) return []
		const sessions: SessionModelTarget[] = []
		for (const item of result.items) {
			if (typeof item !== "object" || item === null) continue
			const row = item as Record<string, unknown>
			if (typeof row.sessionId !== "string" || row.sessionId === "") continue
			sessions.push({
				sessionId: row.sessionId,
				blank: row.blank === true,
				running: row.running === true,
			})
		}
		return sessions
	}

	async selectModel(sessionId: string, selection: DefaultSelection): Promise<void> {
		await this.call("session/selectModel", {
			request: {
				sessionId,
				provider: selection.provider,
				model: selection.model,
				...(selection.reasoningEffort === undefined
					? {}
					: { reasoningEffort: selection.reasoningEffort }),
			},
		})
	}

	private async call<T>(method: string, args: unknown): Promise<T> {
		const rpcId = randomUUID()
		let response: Awaited<ReturnType<DshRuntimeProcess["request"]>>
		try {
			response = await this.runtime.request(
				{
					requestId: randomUUID(),
					path: `/api/${method}`,
					method: "POST",
					headers: [
						["content-type", "application/json"],
						["accept", "application/json"],
					],
					body: new TextEncoder().encode(
						JSON.stringify({
							type: "client-request",
							rpcId,
							method,
							payload: { args },
						}),
					),
				},
				new AbortController().signal,
			)
		} catch {
			throw new DshCloudConfigUnavailableError()
		}
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`DSH request ${method} failed with HTTP ${String(response.status)}`)
		}
		let envelope: RpcEnvelope<T>
		try {
			envelope = JSON.parse(new TextDecoder().decode(response.body)) as RpcEnvelope<T>
		} catch {
			throw new Error(`DSH request ${method} returned invalid JSON`)
		}
		if (envelope.type !== "server-response" || envelope.result === undefined) {
			throw new Error(`DSH request ${method} returned an invalid response envelope`)
		}
		if (envelope.rpcId !== rpcId)
			throw new Error(`DSH request ${method} returned a mismatched rpcId`)
		const result = envelope.result
		if (result.ok === true) return result.value as T
		throw new Error(`${result.error.code}: ${result.error.message}`)
	}
}
