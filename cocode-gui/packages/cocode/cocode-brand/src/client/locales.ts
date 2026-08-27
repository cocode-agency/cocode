export const zh = {
	title: "侧边栏 Logo",
	cocode: "Cocode",
	deepseek: "DeepSeek Harness",
} satisfies Record<string, string>

export type BrandLocaleKey = keyof typeof zh

export const en = {
	title: "Sidebar logo",
	cocode: "Cocode",
	deepseek: "DeepSeek Harness",
} satisfies Record<BrandLocaleKey, string>

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface LocaleNamespaceMap {
		"settings.brand": BrandLocaleKey
	}
}
