import { defineStore, type EngineStoreHandle } from "@deepseek-ai/dsh-client-runtime/client"
import type { ThemePreference } from "@deepseek-ai/dsh-client-ui-theme/client"
import { DEFAULT_MESSAGE_FONT_SIZE, type MessageFontSize } from "./font-size.ts"

export interface AppearanceSectionState {
	preference: ThemePreference
	activeColorScheme: "light" | "dark"
	messageFontSize: MessageFontSize
	revision: number
}

type AppearanceSectionActions = {
	sync: (
		draft: AppearanceSectionState,
		preference: ThemePreference,
		activeColorScheme: "light" | "dark",
		messageFontSize: MessageFontSize,
		revision: number,
	) => void
}

export function createAppearanceSectionStore(): EngineStoreHandle<AppearanceSectionState, AppearanceSectionActions> {
	return defineStore({
		init: (): AppearanceSectionState => ({
			preference: "system",
			activeColorScheme: "light",
			messageFontSize: DEFAULT_MESSAGE_FONT_SIZE,
			revision: -1,
		}),
		actions: {
			sync: (
				d: AppearanceSectionState,
				preference: ThemePreference,
				activeColorScheme: "light" | "dark",
				messageFontSize: MessageFontSize,
				revision: number,
			) => {
				if (revision <= d.revision) return
				d.preference = preference
				d.activeColorScheme = activeColorScheme
				d.messageFontSize = messageFontSize
				d.revision = revision
			},
		},
	})
}
