import assert from "node:assert/strict"
import test from "node:test"
import { spoofFileLoopbackHostname } from "../../src/renderer/app/bootstrap/file-loopback-hostname"

test("file pages present as loopback before DSH connection reads location", () => {
	class FileLocation {
		protocol = "file:"
		get hostname() {
			return ""
		}
	}
	const location = new FileLocation()
	spoofFileLoopbackHostname(location)
	assert.equal(location.hostname, "127.0.0.1")
})

test("http pages keep their real hostname", () => {
	class HttpLocation {
		protocol = "http:"
		get hostname() {
			return "example.test"
		}
	}
	const location = new HttpLocation()
	spoofFileLoopbackHostname(location)
	assert.equal(location.hostname, "example.test")
})
