import { describe, expect, it, vi } from "vitest"
import { WorkspaceIndexCache, type WorkspaceIndex } from "../src/file-search-engine.ts"

function index(paths: readonly string[], estimatedBytes = 64): WorkspaceIndex {
	return { paths, estimatedBytes, truncated: false }
}

interface Deferred<T> {
	readonly promise: Promise<T>
	resolve(value: T): void
	reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

describe("WorkspaceIndexCache", () => {
	it("reuses an in-flight index past the TTL and starts expiry after completion", async () => {
		let now = 0
		const pending = deferred<WorkspaceIndex>()
		const load = vi
			.fn()
			.mockImplementationOnce(() => pending.promise)
			.mockResolvedValueOnce(index(["refreshed.ts"]))
		const cache = new WorkspaceIndexCache(8_000, 128, 2, () => now)

		const first = cache.get("workspace", load)
		now = 20_000
		const whilePending = cache.get("workspace", load)

		expect(whilePending).toBe(first)
		await Promise.resolve()
		expect(load).toHaveBeenCalledTimes(1)

		pending.resolve(index(["initial.ts"]))
		await expect(first).resolves.toEqual(index(["initial.ts"]))

		now = 27_999
		expect(cache.get("workspace", load)).toBe(first)
		expect(load).toHaveBeenCalledTimes(1)

		now = 28_000
		await expect(cache.get("workspace", load)).resolves.toEqual(index(["refreshed.ts"]))
		expect(load).toHaveBeenCalledTimes(2)
	})

	it("coalesces in-flight indexes without applying the settled byte budget", async () => {
		const pendingOne = deferred<WorkspaceIndex>()
		const pendingTwo = deferred<WorkspaceIndex>()
		const pendingThree = deferred<WorkspaceIndex>()
		const loadOne = vi.fn(() => pendingOne.promise)
		const loadTwo = vi.fn(() => pendingTwo.promise)
		const loadThree = vi.fn(() => pendingThree.promise)
		const cache = new WorkspaceIndexCache(8_000, 128, 3)

		const first = cache.get("one", loadOne)
		const second = cache.get("two", loadTwo)
		const third = cache.get("three", loadThree)

		expect(cache.get("one", loadOne)).toBe(first)
		await Promise.resolve()
		expect([loadOne, loadTwo, loadThree].map((load) => load.mock.calls.length)).toEqual([
			1, 1, 1,
		])

		pendingOne.resolve(index(["one.ts"]))
		await expect(first).resolves.toEqual(index(["one.ts"]))
		expect(cache.get("one", loadOne)).toBe(first)
		expect(loadOne).toHaveBeenCalledTimes(1)

		pendingTwo.resolve(index(["two.ts"]))
		pendingThree.resolve(index(["three.ts"]))
		await expect(Promise.all([second, third])).resolves.toEqual([index(["two.ts"]), index(["three.ts"])])
	})

	it("bounds distinct in-flight workspaces", async () => {
		const pendingOne = deferred<WorkspaceIndex>()
		const pendingTwo = deferred<WorkspaceIndex>()
		const cache = new WorkspaceIndexCache(8_000, 128, 2)

		const first = cache.get("one", () => pendingOne.promise)
		const second = cache.get("two", () => pendingTwo.promise)
		await expect(cache.get("three", async () => index(["three.ts"]))).rejects.toThrow(/busy indexing/)

		pendingOne.resolve(index(["one.ts"]))
		pendingTwo.resolve(index(["two.ts"]))
		await Promise.all([first, second])
	})

	it("evicts least recently used indexes to stay within the byte budget", async () => {
		const loadOne = vi.fn().mockResolvedValue(index(["one.ts"], 64))
		const loadTwo = vi.fn().mockResolvedValue(index(["two.ts"], 64))
		const loadThree = vi.fn().mockResolvedValue(index(["three.ts"], 64))
		const cache = new WorkspaceIndexCache(8_000, 128)

		const first = cache.get("one", loadOne)
		await first
		await cache.get("two", loadTwo)
		expect(cache.get("one", loadOne)).toBe(first)
		await cache.get("three", loadThree)

		expect(cache.get("one", loadOne)).toBe(first)
		await expect(cache.get("two", loadTwo)).resolves.toEqual(index(["two.ts"], 64))
		expect(loadOne).toHaveBeenCalledTimes(1)
		expect(loadTwo).toHaveBeenCalledTimes(2)
	})

	it("evicts a failed index so the next request can retry", async () => {
		const load = vi
			.fn()
			.mockRejectedValueOnce(new Error("index failed"))
			.mockResolvedValueOnce(index(["recovered.ts"]))
		const cache = new WorkspaceIndexCache()

		await expect(cache.get("workspace", load)).rejects.toThrow("index failed")
		await expect(cache.get("workspace", load)).resolves.toEqual(index(["recovered.ts"]))
		expect(load).toHaveBeenCalledTimes(2)
	})
})
