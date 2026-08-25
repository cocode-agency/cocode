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
		workspace: {
			list: async () => ({
				result: {
					ok: true as const,
					value: { items: [], archivedSessionIds: [] as string[] },
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

	assert.deepEqual(createCalls, [{}])
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
