import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "pathe"
import test from "node:test"
import assert from "node:assert/strict"
import { serializeError } from "../../../src/main/shared/logging/error-serializer"
import { sanitizeAttributes, sanitizePath } from "../../../src/main/shared/logging/redaction"
import { RotatingFileSink } from "../../../src/main/shared/logging/rotating-file-sink"
import { DesktopLogger } from "../../../src/main/shared/logging/desktop-logger"

test("redaction removes sensitive attributes and URL query strings", () => {
	const result = sanitizeAttributes({
		Authorization: "Bearer test-token",
		promptText: "sample prompt",
		endpoint: "https://example.test/api?token=test#fragment",
		count: 3,
	})
	assert.equal(result?.Authorization, "[REDACTED]")
	assert.equal(result?.promptText, "[REDACTED]")
	assert.equal(result?.endpoint, "https://example.test/api")
	assert.equal(result?.count, 3)
	assert.equal(sanitizeAttributes({ details: "sample prompt" })?.details, "[REDACTED]")
})

test("redaction replaces home, DSH home, and workspace paths", () => {
	assert.equal(
		sanitizePath("/Users/alice/.dsh/workspaces/project/src/main.ts"),
		"<user-home>/<dsh-home>/<workspace>/src/main.ts",
	)
})

test("error serializer bounds and cleans thrown values", () => {
	const error = new Error(
		`line one\nBearer test-token https://example.test/path?secret=test ${"x".repeat(3_000)}`,
	)
	;(error as Error & { code?: string }).code = "E_TEST"
	const serialized = serializeError(error)
	assert.equal(serialized.name, "Error")
	assert.equal(serialized.code, "E_TEST")
	assert.ok(!serialized.message.includes("\n"))
	assert.ok(!serialized.message.includes("test-token"))
	assert.ok(!serialized.message.includes("?secret=test"))
	assert.ok(serialized.message.length <= 2_048)
	assert.ok((serialized.stack?.length ?? 0) <= 8_192)
})

test("error serializer redacts authorization and cookie values", () => {
	const serialized = serializeError(
		new Error('Authorization: Bearer secret Cookie: session=private "apiKey":"hidden"'),
	)
	assert.doesNotMatch(serialized.message, /secret|private|hidden/)
})

test("error serializer removes complete Windows user paths", () => {
	const serialized = serializeError(
		new Error("cannot open C:\\Users\\alice\\AppData\\Local\\Cocode\\global.db"),
	)
	assert.doesNotMatch(serialized.message, /Users|alice|AppData|global\.db/i)
})

test("rotating sink keeps current file and prunes old files", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "cocode-log-sink-"))
	const sink = new RotatingFileSink({
		directory,
		filename: "current.jsonl",
		policy: { maxBytes: 32, maxFiles: 1, maxAgeMs: 86_400_000, maxTotalBytes: 128 },
	})
	sink.write("first record\n")
	sink.write("second record that rotates\n")
	sink.close()
	const files = await readdir(directory)
	assert.ok(files.includes("current.jsonl"))
	assert.ok(files.some((file) => file.endsWith(".jsonl.gz") || file.endsWith(".jsonl")))
	const current = await readFile(path.join(directory, "current.jsonl"), "utf8")
	assert.ok(current.length > 0)
})

test("rotating sink starts from an existing file date and preserves permissions", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "cocode-log-existing-"))
	await writeFile(path.join(directory, "current.jsonl"), "existing\n", { mode: 0o600 })
	const sink = new RotatingFileSink({
		directory,
		filename: "current.jsonl",
		policy: { maxBytes: 1_024, maxFiles: 2, maxAgeMs: 86_400_000, maxTotalBytes: 4_096 },
	})
	sink.write("next\n")
	sink.close()
	const info = await stat(path.join(directory, "current.jsonl"))
	if (process.platform === "win32") {
		assert.ok(info.isFile())
		assert.ok(info.size > 0)
	} else {
		assert.equal(info.mode & 0o777, 0o600)
	}
})

test("desktop logger writes structured app and emergency records", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "cocode-desktop-logger-"))
	const logger = new DesktopLogger({ directory, defaultLevel: "debug", serviceVersion: "test" })
	logger.log("info", "test.record", {
		message: "https://example.test/path?token=test",
		attributes: { Authorization: "Bearer test-token", count: 2 },
	})
	logger.log("fatal", "test.fatal", { error: new Error("Bearer test-token") })
	logger.close()
	const appLog = await readFile(path.join(directory, "app", "current.jsonl"), "utf8")
	const records = appLog
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>)
	assert.equal(records[0]?.severityText, "INFO")
	assert.equal(records[0]?.eventName, "test.record")
	assert.equal((records[0]?.attributes as Record<string, unknown>)?.Authorization, "[REDACTED]")
	assert.ok(!appLog.includes("test-token"))
	const emergency = await readFile(path.join(directory, "app", "emergency.jsonl"), "utf8")
	assert.ok(emergency.includes('"eventName":"test.fatal"'))
})

test("desktop logger degrades to stderr when the log directory is unavailable", async () => {
	const directory = path.join(
		await mkdtemp(path.join(tmpdir(), "cocode-log-unavailable-")),
		"not-a-directory",
	)
	await writeFile(directory, "sentinel\n")
	assert.doesNotThrow(() => {
		const logger = new DesktopLogger({ directory })
		logger.log("error", "test.unavailable")
		logger.close()
	})
})
