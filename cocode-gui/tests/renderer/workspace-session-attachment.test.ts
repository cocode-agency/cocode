import assert from "node:assert/strict"
import test from "node:test"
import { Context } from "@deepseek-ai/cordis"
import { createSnapshotStore } from "../../packages/client/runtime/src/client/contract/store"
import type {
	SessionsPort,
	SessionsPortSummary,
} from "../../packages/client/runtime/src/client/contract/sessions-port"
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
		byId: {} as Record<string, SessionsPortSummary>,
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
					value: { items: [] as never[], archivedSessionIds: [] as string[] },
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
					value: { items: [] as never[], archivedSessionIds: [] as string[] },
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

test("ordinary chats reuse the selected blank ungrouped session", async () => {
	const sessionsList = createSnapshotStore({
		ids: ["session-blank"],
		byId: {
			"session-blank": {
				id: "session-blank",
				blank: true,
				cwd: "/tmp/cocode-default/session-blank",
				updatedAt: Date.now(),
			},
		},
		current: "session-blank" as string | undefined,
		phase: "ready" as const,
	})
	let createdCount = 0
	const sessions: SessionsPort = {
		list: sessionsList,
		async create() {
			createdCount++
			return "session-new"
		},
		open: () => {},
		clear: () => {},
	}
	const runtime = new WorkspaceRuntime(
		new Context(),
		{
			workspace: {
				list: async () => ({
					result: {
						ok: true as const,
						value: { items: [] as never[], archivedSessionIds: [] as string[] },
					},
				}),
			},
		} as never,
		sessions,
	)
	runtime.configureDefaultStorage("/tmp/cocode-default")

	assert.equal(await runtime.connectDefaultSession(), "session-blank")
	assert.equal(createdCount, 0)
})

test("ordinary chats reuse a hidden non-current blank ungrouped session", async () => {
	const sessionsList = createSnapshotStore({
		ids: ["session-current", "session-hidden-blank"],
		byId: {
			"session-current": {
				id: "session-current",
				blank: false,
				cwd: "/tmp/cocode-default/session-current",
				updatedAt: Date.now(),
			},
			"session-hidden-blank": {
				id: "session-hidden-blank",
				blank: true,
				cwd: "/tmp/cocode-default/session-hidden-blank",
				updatedAt: Date.now() - 1,
			},
		},
		current: "session-current" as string | undefined,
		phase: "ready" as const,
	})
	let createdCount = 0
	const sessions: SessionsPort = {
		list: sessionsList,
		async create() {
			createdCount++
			return "session-new"
		},
		open: () => {},
		clear: () => {},
	}
	const runtime = new WorkspaceRuntime(
		new Context(),
		{
			workspace: {
				list: async () => ({
					result: {
						ok: true as const,
						value: { items: [] as never[], archivedSessionIds: [] as string[] },
					},
				}),
			},
		} as never,
		sessions,
	)
	runtime.configureDefaultStorage("/tmp/cocode-default")

	assert.equal(await runtime.connectDefaultSession(), "session-hidden-blank")
	assert.equal(createdCount, 0)
})

test("ordinary chats coalesce concurrent creates and retry after failure", async () => {
	const sessionsList = createSnapshotStore({
		ids: [] as string[],
		byId: {} as Record<string, SessionsPortSummary>,
		current: undefined,
		phase: "ready" as const,
	})
	let attempts = 0
	let rejectFirst: ((reason: Error) => void) | undefined
	const sessions: SessionsPort = {
		list: sessionsList,
		create: ({ sessionId }) => {
			attempts++
			if (attempts === 1) {
				return new Promise<string>((_resolve, reject) => {
					rejectFirst = reject
				})
			}
			return Promise.resolve(sessionId!)
		},
		open: () => {},
		clear: () => {},
	}
	const runtime = new WorkspaceRuntime(
		new Context(),
		{
			workspace: {
				list: async () => ({
					result: {
						ok: true as const,
						value: { items: [] as never[], archivedSessionIds: [] as string[] },
					},
				}),
			},
		} as never,
		sessions,
	)
	runtime.configureDefaultStorage("/tmp/cocode-default")

	const first = runtime.connectDefaultSession()
	const duplicate = runtime.connectDefaultSession()
	assert.equal(first, duplicate)
	assert.equal(attempts, 1)
	rejectFirst?.(new Error("create failed"))
	await assert.rejects(first, /create failed/)
	assert.match(await runtime.connectDefaultSession(), /^session-[0-9a-f-]{36}$/)
	assert.equal(attempts, 2)
})

test("ordinary chats do not reuse project, archived, or differently stored blanks", async () => {
	const cases = [
		{
			name: "project",
			workspaceSessionIds: ["session-blank"],
			archivedSessionIds: [] as string[],
			configuredRoot: "/tmp/cocode-default",
			cwd: "/tmp/cocode-default/session-blank",
		},
		{
			name: "archived",
			workspaceSessionIds: [] as string[],
			archivedSessionIds: ["session-blank"],
			configuredRoot: "/tmp/cocode-default",
			cwd: "/tmp/cocode-default/session-blank",
		},
		{
			name: "storage",
			workspaceSessionIds: [] as string[],
			archivedSessionIds: [] as string[],
			configuredRoot: "/tmp/new",
			cwd: "/tmp/old/session-blank",
		},
	]

	for (const scenario of cases) {
		const sessionsList = createSnapshotStore({
			ids: ["session-blank"],
			byId: {
				"session-blank": {
					id: "session-blank",
					blank: true,
					...(scenario.cwd === undefined ? {} : { cwd: scenario.cwd }),
					updatedAt: Date.now(),
				},
			},
			current: "session-blank" as string | undefined,
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
		const workspace = {
			workspaceId: "ws-test",
			path: "/tmp/project",
			title: "project",
			sessionIds: scenario.workspaceSessionIds,
			createdAt: "2026-08-16T00:00:00.000Z",
			updatedAt: "2026-08-16T00:00:00.000Z",
		}
		const runtime = new WorkspaceRuntime(
			new Context(),
			{
				workspace: {
					list: async () => ({
						result: {
							ok: true as const,
							value: {
								items: [workspace],
								archivedSessionIds: scenario.archivedSessionIds,
							},
						},
					}),
				},
			} as never,
			sessions,
		)
		await runtime.refresh()
		runtime.configureDefaultStorage(scenario.configuredRoot)

		const sessionId = await runtime.connectDefaultSession()
		assert.equal(receivedSessionId, sessionId)
		assert.match(sessionId, /^session-[0-9a-f-]{36}$/)
		assert.equal(receivedCwd, `${scenario.configuredRoot}/${sessionId}`)
	}
})
