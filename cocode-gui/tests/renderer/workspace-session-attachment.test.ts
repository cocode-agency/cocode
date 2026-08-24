import assert from "node:assert/strict"
import test from "node:test"
import { Context } from "@deepseek-ai/cordis"
import { createSnapshotStore } from "../../packages/client/runtime/src/client/contract/store"
import type { SessionsPort } from "../../packages/client/runtime/src/client/contract/sessions-port"
import { WorkspaceRuntime } from "../../packages/client/runtime/src/client/workspaces/service"

test("new sessions stay in the selected workspace before host frames arrive", async () => {
	const workspaceId = "ws-test"
	const workspacePath = "/tmp/cocode-workspace-test"
	const workspace = {
		workspaceId,
		path: workspacePath,
		title: "cocode-workspace-test",
		sessionIds: [] as string[],
		createdAt: "2026-08-16T00:00:00.000Z",
		updatedAt: "2026-08-16T00:00:00.000Z",
	}
	const api = {
		workspace: {
			list: async () => ({
				result: {
					ok: true as const,
					value: { items: [workspace], archivedSessionIds: [] as string[] },
				},
			}),
		},
	}
	const sessionsList = createSnapshotStore({
		ids: [] as string[],
		byId: {},
		current: undefined,
		phase: "ready" as const,
	})
	let createdCount = 0
	const sessions: SessionsPort = {
		list: sessionsList,
		async create({ workspaceId: target, cwd }) {
			assert.equal(target, workspaceId)
			const sessionId = `session-new-${++createdCount}`
			sessionsList.update((draft) => {
				draft.ids = [sessionId, ...draft.ids]
				draft.byId[sessionId] = {
					id: sessionId,
					blank: true,
					...(cwd === undefined ? {} : { cwd }),
					updatedAt: Date.now(),
				}
			})
			return sessionId
		},
		open: () => {},
		clear: () => {},
	}
	const runtime = new WorkspaceRuntime(new Context(), api as never, sessions)

	await runtime.refresh()
	const first = await runtime.connectWorkspace(workspaceId)

	assert.deepEqual(
		runtime.list.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
			?.sessionIds,
		[first],
	)
	assert.equal(sessionsList.getSnapshot().byId[first]?.cwd, workspacePath)

	const second = await runtime.connectWorkspace(workspaceId)
	assert.equal(second, first)
	assert.equal(createdCount, 1)
})

test("new session without a project workspace creates an ungrouped chat", async () => {
	const api = {
		host: {
			describe: async () => ({
				result: {
					ok: true as const,
					value: {
						version: "test",
						cwd: "/tmp/cocode-default",
						attachedSessions: 0,
						canOpenPath: false,
					},
				},
			}),
		},
		workspace: {
			list: async () => ({
				result: {
					ok: true as const,
					value: { items: [], archivedSessionIds: [] as string[] },
				},
			}),
		},
	}
	const sessionsList = createSnapshotStore({
		ids: [] as string[],
		byId: {} as Record<string, { id: string; blank: boolean; updatedAt: number }>,
		current: undefined as string | undefined,
		phase: "ready" as const,
	})
	let opened: string | undefined
	const sessions: SessionsPort = {
		list: sessionsList,
		async create({ workspaceId, cwd, sessionId }) {
			assert.equal(workspaceId, undefined)
			assert.match(sessionId ?? "", /^session-[0-9a-f-]{36}$/)
			assert.equal(cwd, `/tmp/cocode-default/${sessionId}`)
			sessionsList.update((draft) => {
				draft.ids = [sessionId!]
				draft.byId[sessionId!] = { id: sessionId!, blank: true, updatedAt: Date.now() }
			})
			return sessionId!
		},
		open: (sessionId) => {
			opened = sessionId
		},
		clear: () => {},
	}
	const runtime = new WorkspaceRuntime(new Context(), api as never, sessions)

	await runtime.refresh()
	runtime.startSession()
	await new Promise((resolve) => setImmediate(resolve))

	assert.match(opened ?? "", /^session-[0-9a-f-]{36}$/)
})

test("ordinary chats use the configured default storage path", async () => {
	const api = {
		host: {
			describe: async () => {
				throw new Error("configured storage must not query the Host default")
			},
		},
		workspace: {
			list: async () => ({
				result: {
					ok: true as const,
					value: { items: [], archivedSessionIds: [] as string[] },
				},
			}),
		},
	}
	const sessionsList = createSnapshotStore({
		ids: [] as string[],
		byId: {} as Record<string, { id: string; blank: boolean; updatedAt: number }>,
		current: undefined as string | undefined,
		phase: "ready" as const,
	})
	let receivedCwd: string | undefined
	let receivedSessionId: string | undefined
	const sessions: SessionsPort = {
		list: sessionsList,
		async create({ cwd, sessionId }) {
			receivedCwd = cwd
			receivedSessionId = sessionId
			return sessionId!
		},
		open: () => {},
		clear: () => {},
	}
	const runtime = new WorkspaceRuntime(new Context(), api as never, sessions)

	runtime.configureDefaultStorage("/tmp/recent-cocode")
	const sessionId = await runtime.connectDefaultSession()
	assert.equal(receivedSessionId, sessionId)
	assert.match(sessionId, /^session-[0-9a-f-]{36}$/)
	assert.equal(receivedCwd, `/tmp/recent-cocode/${sessionId}`)
})
