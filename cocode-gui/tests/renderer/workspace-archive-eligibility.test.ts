import assert from "node:assert/strict"
import test from "node:test"
import { indexSubagentDescendants } from "../../packages/client/client/runtime/src/client/sessions/subagent-lineage"
import type { SessionSummary } from "../../packages/client/client/runtime/src/client/sessions/service"
import { sessionArchiveEligible } from "../../packages/client/client/ui-workspace/src/client/archive"

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id,
		displayTitle: id,
		running: false,
		blank: false,
		updatedAt: 1,
		...overrides,
	}
}

function required<T>(value: T | undefined): T {
	assert.notEqual(value, undefined)
	return value
}

test("workspace archive keeps unread and active conversations visible", () => {
	const sessions = [
		summary("read-idle"),
		summary("unread-completed", { completed: true }),
		summary("running", { running: true }),
		summary("waiting", { pendingInteraction: "approval" }),
		summary("blank", { blank: true }),
		summary("parent-with-running-child"),
		summary("running-child", {
			running: true,
			origin: "subagent",
			parentId: "parent-with-running-child",
		}),
	]
	const byId = Object.fromEntries(sessions.map((session) => [session.id, session]))
	const descendants = indexSubagentDescendants(byId)

	assert.equal(sessionArchiveEligible(required(byId["read-idle"]), descendants), true)
	assert.equal(sessionArchiveEligible(required(byId["unread-completed"]), descendants), false)
	assert.equal(sessionArchiveEligible(required(byId.running), descendants), false)
	assert.equal(sessionArchiveEligible(required(byId.waiting), descendants), false)
	assert.equal(sessionArchiveEligible(required(byId.blank), descendants), false)
	assert.equal(
		sessionArchiveEligible(required(byId["parent-with-running-child"]), descendants),
		false,
	)
})
