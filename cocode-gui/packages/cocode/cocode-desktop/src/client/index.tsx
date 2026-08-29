import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots"
import type {} from "@deepseek-ai/dsh-client-locale/client"
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client"
import type {} from "@deepseek-ai/dsh-client-ui-layout/client"
import type {} from "@deepseek-ai/dsh-client-ui-settings/client"
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client"
import { RecoveryBanner } from "./RecoveryBanner.tsx"
import { SettingsRoot } from "./SettingsRoot.tsx"
import { findSidebarColumn } from "./titlebar.ts"
import type { SettingsOnboardingStep, SettingsRootInjected, SettingsSectionRow } from "./shell-contract.ts"
import "./chrome.module.css"

export const inject = ["slots", "locale"]

function HiddenStats(): null {
	return null
}

function mountTitlebar(ctx: ClientContext): void {
	if (typeof document === "undefined") return
	ctx.effect(() => {
		const strip = document.createElement("div")
		strip.dataset.desktopTitlebarDrag = ""
		strip.setAttribute("aria-hidden", "true")
		let attached: Element | undefined
		const attach = (): boolean => {
			const overlay = document.querySelector("[data-shell-overlay]")
			const sidebar = overlay === null ? null : findSidebarColumn(overlay)
			if (sidebar == null || sidebar === overlay) return false
			if (attached !== sidebar) {
				sidebar.setAttribute("data-cocode-sidebar", "")
				sidebar.prepend(strip)
				attached = sidebar
			}
			return true
		}
		const timer = window.setInterval(() => {
			if (attach()) window.clearInterval(timer)
		}, 50)
		attach()
		return () => {
			window.clearInterval(timer)
			strip.remove()
			attached?.removeAttribute("data-cocode-sidebar")
		}
	}, "cocode-desktop: titlebar")
}

/**
 * Replace the DSH settings shell, hide composer stats, and mount desktop chrome.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
	mountTitlebar(ctx)

	let rowsVersion = -1
	let rowsRevision = -1
	let rows: readonly SettingsSectionRow[] = []
	let onboardingVersion = -1
	let onboardingSteps: readonly SettingsOnboardingStep[] = []
	const shellInjected = (): SettingsRootInjected => ({
		hooks: {
			sections: {
				getSnapshot: () => {
					const version = ctx.slots.getVersion("settings.section")
					const revision = ctx.locale.getSnapshot().revision
					if (version !== rowsVersion || revision !== rowsRevision) {
						rowsVersion = version
						rowsRevision = revision
						rows = ctx.slots.entries("settings.section")
							.map((entry) => ({
								id: entry.options.id ?? "",
								order: entry.options.order ?? 0,
								label: resolveSlotLabel(entry.options.label) ?? "",
							}))
							.sort((left, right) => left.order - right.order)
					}
					return rows
				},
				subscribe: (listener) => {
					const offLedger = ctx.slots.subscribe("settings.section", listener)
					const offLocale = ctx.locale.subscribe(listener)
					return () => {
						offLedger()
						offLocale()
					}
				},
			},
			onboardingSteps: {
				getSnapshot: () => {
					const version = ctx.slots.getVersion("settings.onboarding")
					if (version !== onboardingVersion) {
						onboardingVersion = version
						onboardingSteps = ctx.slots.entries("settings.onboarding")
							.map((entry) => ({
								id: entry.options.id ?? "",
								order: entry.options.order ?? 0,
							}))
							.sort((left, right) => left.order - right.order)
					}
					return onboardingSteps
				},
				subscribe: (listener) => ctx.slots.subscribe("settings.onboarding", listener),
			},
		},
	})

	ctx.slots.inject("sidebar.settings", () =>
		ctx.slots.inject("shell.overlay", () =>
			ctx.slots.inject("conversation.composer.dock", function* () {
				yield ctx.slots.register({
					name: "sidebar.settings",
					priority: -1,
					inject: shellInjected,
					// Children stay declared by ui-settings-general; repeating them here collides.
				} as never, SettingsRoot)
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "cocode-recovery",
					order: 0,
				}, RecoveryBanner)
				yield ctx.slots.register({
					name: "conversation.composer.dock",
					id: "stats",
					priority: -1,
					order: 0,
				}, HiddenStats)
			})))
}
