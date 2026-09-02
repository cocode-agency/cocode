import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const patch = readFileSync(
	"patches/@deepseek-ai__dsh-client-ui-conversation@0.1.2-alpha.5.patch",
	"utf8",
)
const chromeStyles = readFileSync(
	"packages/cocode/cocode-desktop/src/client/chrome.module.css",
	"utf8",
)

test("keeps the workspace clear affordance in the folder slot", () => {
	assert.match(patch, /cocode-workspace-wrap-clearable/)
	assert.match(patch, /cocode-workspace-clear/)
	assert.match(patch, /onClear: sessionWorkspace !== void 0/)
	assert.match(patch, /\+\s*if \(workspaceId === void 0\) \{\s*\+\s*sessions\.clear\(\)/)
	assert.doesNotMatch(
		patch,
		/\+\s*\(0, react_jsx_runtime\.jsx\)\(_deepseek_ai_dsh_client_ui_primitives\.IconChevronDownOutline14/,
	)
	assert.match(chromeStyles, /cocode-workspace-wrap-clearable:hover \.cocode-workspace-clear/)
	assert.match(
		chromeStyles,
		/cocode-workspace-wrap-clearable:focus-within \.cocode-workspace-clear/,
	)
	assert.match(
		chromeStyles,
		/cocode-workspace-wrap-clearable:hover \.cocode-workspace[\s\S]*background: var\(--dsw-alias-interactive-bg-hover\)/,
	)
	assert.match(chromeStyles, /cocode-workspace-wrap-clearable:hover \.cocode-workspace-folder/)
	assert.match(chromeStyles, /top: 0;\s*\n\s*bottom: 0;/)
	assert.match(chromeStyles, /margin-block: auto;/)
	assert.match(chromeStyles, /line-height: 0;/)
	assert.match(chromeStyles, /cocode-workspace\) \{[\s\S]*gap: 5px;[\s\S]*padding-left: 5px;/)
	assert.match(chromeStyles, /cocode-workspace-icon\) \{[\s\S]*width: 18px;[\s\S]*height: 18px;/)
	assert.match(chromeStyles, /left: 5px/)
	assert.match(chromeStyles, /cocode-workspace-clear svg[\s\S]*display: block/)
	assert.doesNotMatch(chromeStyles, /cocode-workspace-clear svg[\s\S]*translateY/)
})
