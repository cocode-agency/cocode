import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import type {} from "@deepseek-ai/dsh-client-locale/client"
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client"
import type {} from "@deepseek-ai/dsh-client-ui-settings/client"
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client"
import type {} from "@deepseek-ai/dsh-client-ui-slots"
import { BrandMark, BrandName, HeroBrandMark } from "./Brand.tsx"
import { LogoRow } from "./LogoRow.tsx"
import { en, zh } from "./locales.ts"
import { syncLogoDataset } from "./logo-settings.ts"

export const inject = ["slots", "locale"]

const NS = "settings.brand"

// The upstream web bundle still mounts its official brand occupant at the
// default priority. Cocode is the deployment-owned replacement, so it must
// explicitly shadow that occupant instead of colliding at priority 0.
const BRAND_PRIORITY = -1

/**
 * Fill the DSH brand slots and the General-settings logo picker.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
	syncLogoDataset()
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "cocode-brand: dictionaries")
	ctx.slots.inject("sidebar.brand.mark", () =>
		ctx.slots.inject("sidebar.brand.name", () =>
			ctx.slots.inject("conversation.hero.brand.mark", () =>
				ctx.slots.inject("settings.general.item", function* () {
					yield ctx.slots.register({ name: "sidebar.brand.mark", priority: BRAND_PRIORITY }, BrandMark)
					yield ctx.slots.register({ name: "sidebar.brand.name", priority: BRAND_PRIORITY }, BrandName)
					yield ctx.slots.register({ name: "conversation.hero.brand.mark", priority: BRAND_PRIORITY }, HeroBrandMark)
					yield ctx.slots.register({
						name: "settings.general.item",
						id: "cocode-logo",
						order: 15,
						locale: NS,
					}, LogoRow)
				}))))
}
