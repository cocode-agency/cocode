import type { BoundActions } from "@deepseek-ai/dsh-client-ui-slots"
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import type {} from "@deepseek-ai/dsh-client-locale/client"
import type {} from "@deepseek-ai/dsh-client-ui-settings/client"
import type {} from "@deepseek-ai/dsh-client-ui-settings/client"
import type { ThemeRuntime, ThemeSnapshot } from "@deepseek-ai/dsh-client-ui-theme/client"
import type {} from "@deepseek-ai/dsh-client-ui-theme/client"
import { AppearanceSection, type AppearanceSectionInjected } from "./AppearanceSection.tsx"
import {
	applyMessageFontSize,
	clearMessageFontSize,
	hasStoredMessageFontSize,
	isMessageFontSize,
	readStoredMessageFontSize,
	writeStoredMessageFontSize,
	type MessageFontSize,
} from "./font-size.ts"
import { en, zh } from "./locales.ts"
import { createAppearanceSectionStore } from "./settings-store.ts"
import tokens from "../styles/tokens.css?inline"

export const inject = ["slots", "locale", "theme", "settingsScope"]

const NS = "settings.appearance"
const TOKEN_PLUGIN_ID = "cocode-appearance"

function HiddenAppearanceRow(): null {
	return null
}

function installTokens(ctx: ClientContext): void {
	if (typeof document === "undefined") return
	ctx.effect(() => {
		const tag = document.createElement("style")
		tag.dataset.plugin = TOKEN_PLUGIN_ID
		tag.dataset.pluginCss = `${TOKEN_PLUGIN_ID}/tokens.css`
		tag.textContent = tokens
		document.head.appendChild(tag)
		return () => { tag.remove() }
	}, "cocode-appearance: tokens")
}

/**
 * Own the Appearance settings section, hide the DSH General appearance row,
 * and apply Cocode design tokens plus the message-list font size.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
	installTokens(ctx)
	const theme = ctx.get("theme") as ThemeRuntime
	let messageFontSize = readStoredMessageFontSize()
	applyMessageFontSize(messageFontSize)
	ctx.effect(() => () => clearMessageFontSize(), "cocode-appearance: message font-size")
	const legacySettings = ctx.settingsScope.bind<{ readonly messageFontSize?: unknown }>({ namespace: "ui-theme" })
	let migratedLegacyFontSize = hasStoredMessageFontSize()
	const migrateLegacyFontSize = (): void => {
		if (migratedLegacyFontSize) return
		const snapshot = legacySettings.getSnapshot()
		if (snapshot.status === "loading") return
		const legacy = (snapshot.user as { readonly messageFontSize?: unknown } | undefined)?.messageFontSize
		if (isMessageFontSize(legacy)) {
			messageFontSize = legacy
			writeStoredMessageFontSize(legacy)
			applyMessageFontSize(legacy)
		}
		migratedLegacyFontSize = true
	}
	ctx.effect(() => {
		const off = legacySettings.subscribe(migrateLegacyFontSize)
		migrateLegacyFontSize()
		return off
	}, "cocode-appearance: legacy font-size migration")
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "cocode-appearance: dictionaries")

	const store = createAppearanceSectionStore()
	let bound: BoundActions<typeof store> | undefined
	let revision = 0
	const sync = (snapshot: ThemeSnapshot): void => {
		revision += 1
		bound?.sync(snapshot.preference, snapshot.active.colorScheme, messageFontSize, revision)
	}
	const setMessageFontSize = (size: MessageFontSize): void => {
		if (!isMessageFontSize(size) || messageFontSize === size) return
		messageFontSize = size
		writeStoredMessageFontSize(size)
		applyMessageFontSize(size)
		sync(theme.getTheme())
	}
	ctx.on("theme/change", sync)
	const injected = (actions: BoundActions<typeof store>): AppearanceSectionInjected => {
		bound = actions
		sync(theme.getTheme())
		return {
			setTheme: (id) => { theme.setTheme(id) },
			setMessageFontSize,
		}
	}
	const t = ctx.locale.bind(NS)
	ctx.slots.inject("settings.general.item", () =>
		ctx.slots.inject("settings.section", function* () {
			yield ctx.slots.register({
				name: "settings.general.item",
				id: "appearance",
				priority: -1,
				order: 10,
			}, HiddenAppearanceRow)
			yield ctx.slots.register({
				name: "settings.section",
				id: "appearance",
				order: 5,
				label: () => t("nav"),
				locale: NS,
				store,
				inject: injected,
			}, AppearanceSection)
		}))
}
