import { BrandWordmark } from "@deepseek-ai/dsh-client-ui-primitives"
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots"
import type {} from "@deepseek-ai/dsh-client-ui-settings/client"
import { CocodeLogo } from "./CocodeLogo.tsx"
import type {} from "./locales.ts"
import { setLogoPreference, useLogoPreference, type LogoPreference } from "./logo-settings.ts"
import css from "./brand.module.css"

export type LogoRowProps =
	PropsRuntime<"settings.general.item">
	& PropsLocale<"settings.brand">

function cubeClass(selected: boolean): string {
	const base = css.logoCube ?? "logoCube"
	return selected ? `${base} ${css.selected ?? "selected"}` : base
}

/** General-settings cubes that switch the live brand occupants. */
export function LogoRow({ t }: LogoRowProps) {
	const preference = useLogoPreference()
	return (
		<div className={css.group}>
			<div className={css.title}>{t("title")}</div>
			<div className={css.cubeRow}>
				<button
					type="button"
					className={cubeClass(preference === "cocode")}
					aria-pressed={preference === "cocode"}
					onClick={() => { setLogoPreference("cocode") }}
				>
					<span className={css.logoPreview}><CocodeLogo variant="wordmark" size={18} /></span>
					{t("cocode")}
				</button>
				<button
					type="button"
					className={cubeClass(preference === "deepseek")}
					aria-pressed={preference === "deepseek"}
					onClick={() => { setLogoPreference("deepseek" satisfies LogoPreference) }}
				>
					<span className={css.logoPreview}><BrandWordmark size={18} /></span>
					{t("deepseek")}
				</button>
			</div>
		</div>
	)
}
