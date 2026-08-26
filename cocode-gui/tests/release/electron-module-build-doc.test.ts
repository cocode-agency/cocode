import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const documentPath = path.resolve("docs/electron-module-build.md")

test("documents the P1 DSH client ownership contract", () => {
	assert.equal(existsSync(documentPath), true)
	const document = readFileSync(documentPath, "utf8")

	assert.match(document, /@deepseek-ai\/dsh-client-web/)
	assert.match(document, /@deepseek-ai\/dsh-client-ui-renderer/)
	assert.match(document, /@deepseek-ai\/dsh-web-app/)
	assert.match(document, /@deepseek-ai\/dsh-client-web-react/)
	assert.match(document, /legacy|旧 upstream|旧包/i)
})

test("documents the target native package matrix and evidence stages", () => {
	const document = readFileSync(documentPath, "utf8")

	for (const packagePattern of [
		/sharp/,
		/@img\/sharp-libvips/,
		/@koromix\/koffi/,
		/node-addon-require-builtin/,
		/@vscode\/ripgrep/,
		/node-addon-landlock-run-linux/,
	]) {
		assert.match(document, packagePattern)
	}

	for (const evidenceStage of [
		/source/,
		/staging/,
		/native/,
		/install smoke/i,
		/updater/,
		/publication/,
	]) {
		assert.match(document, evidenceStage)
	}
	assert.match(document, /Windows.*sharp.*不要求.*sharp-libvips/i)
	assert.match(document, /glibc.*native host|musl.*拒绝/i)
})

test("documents executable verification commands without claiming static startup proof", () => {
	const document = readFileSync(documentPath, "utf8")

	assert.match(document, /run build:runtime/)
	assert.match(document, /verify:runtime|verify-dsh-runtime\.mjs/)
	assert.match(document, /--publish\s+never/)
	assert.match(document, /未证明|未通过|install.*smoke|安装后.*smoke/i)
	assert.doesNotMatch(document, /当前可以确认 Electron 主流程仍能启动/)
})
