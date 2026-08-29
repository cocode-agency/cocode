export const zh = {
	nav: "外观",
	"appearance.title": "外观",
	"appearance.auto": "跟随系统",
	"appearance.light": "浅色",
	"appearance.dark": "深色",
	"appearance.font.title": "消息字号",
	"appearance.font.14": "14 像素",
	"appearance.font.16": "16 像素",
	"appearance.font.18": "18 像素",
	"appearance.font.20": "20 像素",
} satisfies Record<string, string>

export type AppearanceLocaleKey = keyof typeof zh

export const en = {
	nav: "Appearance",
	"appearance.title": "Appearance",
	"appearance.auto": "Follow system",
	"appearance.light": "Light",
	"appearance.dark": "Dark",
	"appearance.font.title": "Message font size",
	"appearance.font.14": "14 px",
	"appearance.font.16": "16 px",
	"appearance.font.18": "18 px",
	"appearance.font.20": "20 px",
} satisfies Record<AppearanceLocaleKey, string>

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface LocaleNamespaceMap {
		"settings.appearance": AppearanceLocaleKey
	}
}
