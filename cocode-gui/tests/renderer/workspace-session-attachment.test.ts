import assert from "node:assert/strict"
import test from "node:test"
import { Context } from "@deepseek-ai/cordis"
import { createSnapshotStore } from "../../packages/client/client/runtime/src/client/contract/store"
import type {
	SessionsPort,
	SessionsPortList,
} from "../../packages/client/client/runtime/src/client/contract/sessions-port"
import { WorkspaceRuntime } from "../../packages/client/client/runtime/src/client/workspaces/service"

function createSessionsPort(
	create: SessionsPort["create"],
	initial: SessionsPortList = {
		ids: [],
		byId: {},
		current: undefined,
		phase: "ready",
	},
): SessionsPort {
	return {
		list: createSnapshotStore(initial),
		create,
		open: () => {},
		clear: () => {},
	}
}

test("workspace sessions are created through the workspace attachment contract", async () => {
	const workspaceId = "ws-test"
	const workspace = {
		workspaceId,
		path: "/tmp/cocode-workspace-test",
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
	const createCalls: Array<{ workspaceId?: string; cwd?: string }> = []
	const sessions = createSessionsPort(async (input) => {
		createCalls.push(input)
		return "session-new-1" as never
	})
	const runtime = new WorkspaceRuntime(new Context(), api as never, sessions)

	await runtime.refresh()
	const sessionId = await runtime.connectWorkspace(workspaceId as never)

	assert.equal(sessionId, "session-new-1")
	assert.deepEqual(createCalls, [{ workspaceId }])
})

test("new session without a project workspace creates and opens an ordinary chat", async () => {
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
	const createCalls: Array<{ workspaceId?: string; cwd?: string }> = []
	let opened: string | undefined
	const sessions = createSessionsPort(async (input) => {
		createCalls.push(input)
		return "session-ordinary" as never
	})
	sessions.open = (sessionId) => {
		opened = sessionId
	}
	const runtime = new WorkspaceRuntime(new Context(), api as never, sessions)

	await runtime.refresh()
	runtime.startSession()
	await new Promise((resolve) => setImmediate(resolve))

	assert.deepEqual(createCalls, [{ cwd: "/tmp/cocode-default" }])
	assert.equal(opened, "session-ordinary")
})

test("ordinary chats use the configured default storage path", async () => {
	const createCalls: Array<{ workspaceId?: string; cwd?: string }> = []
	const sessions = createSessionsPort(async (input) => {
		createCalls.push(input)
		return "session-configured" as never
	})
	const runtime = new WorkspaceRuntime(new Context(), {} as never, sessions)

	runtime.configureDefaultStorage("/tmp/recent-cocode")
	const sessionId = await runtime.connectDefaultSession()

	assert.equal(sessionId, "session-configured")
	assert.deepEqual(createCalls, [{ cwd: "/tmp/recent-cocode" }])
})

test("ordinary chats reuse the selected blank ungrouped session", async () => {
	const sessionsList = createSnapshotStore({
		ids: ["session-blank"] as never[],
		byId: {
			"session-blank": {
				id: "session-blank",
				blank: true,
				cwd: "/tmp/cocode-default",
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
		ids: ["session-current", "session-hidden-blank"] as never[],
		byId: {
			"session-current": {
				id: "session-current",
				blank: false,
				cwd: "/tmp/cocode-default",
				updatedAt: Date.now(),
			},
			"session-hidden-blank": {
				id: "session-hidden-blank",
				blank: true,
				cwd: "/tmp/cocode-default",
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
		ids: [] as never[],
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
			return Promise.resolve("session-new")
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
	assert.equal(await runtime.connectDefaultSession(), "session-new")
	assert.equal(attempts, 2)
})

test("ordinary chats do not reuse project, archived, or differently stored blanks", async () => {
	const cases = [
		{
			workspaceSessionIds: ["session-blank"] as string[],
			archivedSessionIds: [] as string[],
			configuredRoot: "/tmp/cocode-default",
		},
		{
			workspaceSessionIds: [] as string[],
			archivedSessionIds: ["session-blank"] as string[],
			configuredRoot: "/tmp/cocode-default",
		},
		{
			workspaceSessionIds: [] as string[],
			archivedSessionIds: [] as string[],
			configuredRoot: "/tmp/new",
		},
	]

	for (const scenario of cases) {
		const sessionsList = createSnapshotStore({
			ids: ["session-blank"] as never[],
			byId: {
				"session-blank": {
					id: "session-blank",
					blank: true,
					cwd:
						scenario.configuredRoot === "/tmp/new" ? "/tmp/old" : "/tmp/cocode-default",
					updatedAt: Date.now(),
				},
			},
			current: "session-blank" as string | undefined,
			phase: "ready" as const,
		})
		let createdCount = 0
		let receivedCwd: string | undefined
		const sessions: SessionsPort = {
			list: sessionsList,
			async create(input) {
				createdCount++
				receivedCwd = input.cwd
				return "session-new"
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

		assert.equal(await runtime.connectDefaultSession(), "session-new")
		assert.equal(createdCount, 1)
		assert.equal(receivedCwd, scenario.configuredRoot)
	}
})
