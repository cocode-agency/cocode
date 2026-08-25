import assert from "node:assert/strict"
import test from "node:test"
import {
	DSH_CLIENT_MODULES_ID,
	ensureDshModuleLoader,
} from "../../src/renderer/app/bootstrap/dsh-module-loader"

test("installs the queue facade and materializes the preloaded modules bundle", () => {
	const win = globalThis as typeof globalThis & {
		__ModuleLoader__?: unknown
	}
	delete win.__ModuleLoader__

	try {
		const target = ensureDshModuleLoader()
		let received: unknown
		target.load({
			id: DSH_CLIENT_MODULES_ID,
			factory: (require) => {
				assert.throws(() => require("before-system"), /before the module system existed/)
				return {
					createClientModuleSystem: (
						registrationTarget: typeof target,
						bootstrapModule: unknown,
						options: { boot: unknown },
					) => {
						received = { registrationTarget, bootstrapModule, options }
						registrationTarget.mode = "live"
						registrationTarget.load = () => {}
						return { manifest: options.boot as { rev: string } }
					},
					apply: () => {},
				}
			},
		})

		const system = target.create({
			boot: {
				rev: "test",
				entries: [
					{
						id: DSH_CLIENT_MODULES_ID,
						url: "/dsh-client/modules/client.js",
						rev: "modules",
					},
				],
			},
			staticModules: {},
		})

		assert.equal(system.manifest.rev, "test")
		assert.equal(
			(received as { bootstrapModule: { id: string } }).bootstrapModule.id,
			DSH_CLIENT_MODULES_ID,
		)
		assert.equal(target.mode, "live")
		assert.deepEqual(target.pendingQueue, [])
	} finally {
		delete win.__ModuleLoader__
	}
})
