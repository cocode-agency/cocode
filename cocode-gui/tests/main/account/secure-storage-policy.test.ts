import assert from "node:assert/strict"
import test from "node:test"
import { secureStorageUnavailableMessage } from "../../../src/main/contexts/account/infrastructure/secure-storage-policy"

test("explains unavailable OS storage without prescribing a Linux keyring", () => {
	const message = secureStorageUnavailableMessage("basic_text")
	assert.match(message, /secure storage is unavailable/i)
	assert.match(message, /basic_text/)
	assert.match(message, /restart.*desktop session/i)
	assert.doesNotMatch(message, /D-Bus|Keyring|KWallet|COCODE_ALLOW_INSECURE_STORAGE/i)
	assert.doesNotMatch(message, /ck_|sk_|Bearer\s+[A-Za-z0-9._-]+/i)
})
