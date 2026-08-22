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
		async create({ workspaceId }) {
			assert.equal(workspaceId, undefined)
			const sessionId = "session-ungrouped"
			sessionsList.update((draft) => {
				draft.ids = [sessionId]
				draft.byId[sessionId] = { id: sessionId, blank: true, updatedAt: Date.now() }
			})
			return sessionId
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

	assert.equal(opened, "session-ungrouped")
})

test("ordinary chats use the configured default storage path", async () => {
	const api = {
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
	const sessions: SessionsPort = {
		list: sessionsList,
		async create({ cwd }) {
			receivedCwd = cwd
			return "session-default"
		},
		open: () => {},
		clear: () => {},
	}
	const runtime = new WorkspaceRuntime(new Context(), api as never, sessions)

	runtime.configureDefaultStorage("/tmp/recent-cocode")
	assert.equal(await runtime.connectDefaultSession(), "session-default")
	assert.equal(receivedCwd, "/tmp/recent-cocode")
})

test("ordinary chats reuse the selected blank ungrouped session", async () => {
	const sessionsList = createSnapshotStore({
		ids: ["session-blank"],
		byId: {
			"session-blank": { id: "session-blank", blank: true, updatedAt: Date.now() },
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
						value: { items: [], archivedSessionIds: [] as string[] },
					},
				}),
			},
		} as never,
		sessions,
	)

	assert.equal(await runtime.connectDefaultSession(), "session-blank")
	assert.equal(createdCount, 0)
})

test("ordinary chats coalesce concurrent creates and retry after failure", async () => {
	const sessionsList = createSnapshotStore({
		ids: [] as string[],
		byId: {},
		current: undefined,
		phase: "ready" as const,
	})
	let attempts = 0
	let rejectFirst: ((reason: Error) => void) | undefined
	const sessions: SessionsPort = {
		list: sessionsList,
		create: () => {
			attempts++
			if (attempts === 1) {
				return new Promise<string>((_resolve, reject) => {
					rejectFirst = reject
				})
			}
			return Promise.resolve("session-retry")
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
						value: { items: [], archivedSessionIds: [] as string[] },
					},
				}),
			},
		} as never,
		sessions,
	)

	const first = runtime.connectDefaultSession()
	const duplicate = runtime.connectDefaultSession()
	assert.equal(first, duplicate)
	assert.equal(attempts, 1)
	rejectFirst?.(new Error("create failed"))
	await assert.rejects(first, /create failed/)
	assert.equal(await runtime.connectDefaultSession(), "session-retry")
	assert.equal(attempts, 2)
})

test("ordinary chats do not reuse project, archived, or differently stored blanks", async () => {
	const cases = [
		{
			name: "project",
			workspaceSessionIds: ["session-blank"],
			archivedSessionIds: [] as string[],
			cwd: undefined,
		},
		{
			name: "archived",
			workspaceSessionIds: [] as string[],
			archivedSessionIds: ["session-blank"],
			cwd: undefined,
		},
		{
			name: "storage",
			workspaceSessionIds: [] as string[],
			archivedSessionIds: [] as string[],
			cwd: "/tmp/old",
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
		const sessions: SessionsPort = {
			list: sessionsList,
			async create({ cwd }) {
				receivedCwd = cwd
				return `session-${scenario.name}`
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
		if (scenario.name === "storage") runtime.configureDefaultStorage("/tmp/new")

		assert.equal(await runtime.connectDefaultSession(), `session-${scenario.name}`)
		assert.equal(receivedCwd, scenario.name === "storage" ? "/tmp/new" : undefined)
	}
})
