import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots"
import type {} from "@deepseek-ai/dsh-client-locale/client"
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client"
import type {} from "@deepseek-ai/dsh-client-ui-chat/client"
import type {} from "@deepseek-ai/dsh-client-ui-layout/client"
import type {} from "@deepseek-ai/dsh-client-ui-settings/client"
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client"
import { RecoveryBanner } from "./RecoveryBanner.tsx"
import { SidebarRoot } from "./SidebarRoot.tsx"
import { SettingsRoot } from "./SettingsRoot.tsx"
import type { SettingsOnboardingStep, SettingsRootInjected, SettingsSectionRow } from "./shell-contract.ts"
import "./chrome.module.css"

export const inject = ["slots", "locale"]

function HiddenStats(): null {
	return null
}

function HiddenDiagnostic(): null {
	return null
}

/**
 * The 62686e0 desktop surface keeps DSH diagnostics out of chats. Keep the
 * underlying agent-preset/session services available, but shadow the newer
 * presentation entries that expose implementation details in every Electron
 * surface (development and packaged alike).
 */
function mountDesktopDiagnosticsHidden(ctx: ClientContext): void {
	if (typeof document === "undefined" || document.documentElement.dataset.dshDesktop !== "true") return

	ctx.slots.inject("conversation.chat.node", function* () {
		yield ctx.slots.register({
			name: "conversation.chat.node",
			key: "context",
			priority: -1,
		}, HiddenDiagnostic)
		yield ctx.slots.register({
			name: "conversation.chat.node",
			key: "system-prompt",
			priority: -1,
		}, HiddenDiagnostic)
	})

	ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
		name: "conversation.session.header.actions",
		id: "agent-preset",
		priority: -1,
	}, HiddenDiagnostic))
	ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
		name: "conversation.session.header.actions",
		id: "session-log-download",
		priority: -1,
	}, HiddenDiagnostic))
	ctx.slots.inject("conversation.hero.agentPreset", () => ctx.slots.register({
		name: "conversation.hero.agentPreset",
		priority: -1,
	}, HiddenDiagnostic))
}

/**
 * Shadow the dependency's newer sidebar shell with the `62686e0` shell while
 * retaining its already-declared child slots and service injection face.
 */
function mountSidebar(ctx: ClientContext): void {
	ctx.slots.inject("sidebar", () => {
		const declaringEntry = ctx.slots.entries("sidebar").find((entry) => entry.children !== undefined)
		if (declaringEntry === undefined) return () => {}
		const dispose = ctx.slots.register({
			name: "sidebar",
			priority: -1,
			locale: "sidebar",
			inject: (() => declaringEntry.inject?.() ?? {}) as never,
		} as never, SidebarRoot as never)
		const shadow = [...ctx.slots.entries("sidebar")].reverse().find((entry) => entry.component === SidebarRoot)
		if (shadow !== undefined && declaringEntry.children !== undefined) shadow.children = declaringEntry.children
		return dispose
	})
}

/**
 * Replace the DSH settings shell, hide composer stats, and mount desktop chrome.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
	mountDesktopDiagnosticsHidden(ctx)
	mountSidebar(ctx)

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
				subscribe: (listener: () => void) => {
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
				subscribe: (listener: () => void) => ctx.slots.subscribe("settings.onboarding", listener),
			},
		},
	})

	ctx.slots.inject("sidebar.settings", () =>
		ctx.slots.inject("shell.overlay", () =>
			ctx.slots.inject("conversation.composer.dock", function* () {
				const disposeSettings = ctx.slots.register({
					name: "sidebar.settings",
					priority: -1,
					inject: shellInjected,
					// Children stay declared by ui-settings-general; repeating them here collides.
				} as never, SettingsRoot)
				// A shadow occupant does not inherit the declaring entry's render face
				// automatically. Reuse the live declaration so the replacement receives
				// the same renderSlot binding without claiming the child slots twice.
				const settingsEntry = ctx.slots.entries("sidebar.settings")
					.find((entry) => entry.component === SettingsRoot && entry.options.priority === -1)
				const declaringEntry = ctx.slots.entries("sidebar.settings")
					.find((entry) => entry !== settingsEntry && entry.children !== undefined)
				if (settingsEntry !== undefined && declaringEntry?.children !== undefined) {
					settingsEntry.children = declaringEntry.children
				}
				yield disposeSettings
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
