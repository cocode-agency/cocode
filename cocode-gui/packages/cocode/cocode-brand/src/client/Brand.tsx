import { BrandWordmark, FishLogo } from "@deepseek-ai/dsh-client-ui-primitives"
import type { HeroBrandMarkOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client"
import type { SidebarBrandMarkOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client"
import { CocodeLogo } from "./CocodeLogo.tsx"
import { useLogoPreference } from "./logo-settings.ts"
import css from "./brand.module.css"

type BrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

function classNames(...parts: Array<string | undefined>): string | undefined {
	const joined = parts.filter((part) => part !== undefined && part !== "").join(" ")
	return joined === "" ? undefined : joined
}

/** Sidebar / hero mark: Cocode C, or the DSH fish when DeepSeek is selected. */
export function BrandMark({ size, className }: BrandMarkProps) {
	const preference = useLogoPreference()
	if (preference === "deepseek") return <FishLogo size={size} className={className} />
	return <CocodeLogo variant="mark" size={size} className={classNames(className, size >= 24 ? css.railMark : undefined)} />
}

/** Expanded sidebar name: Cocode wordmark without the leading C, or DSH wordmark. */
export function BrandName() {
	const preference = useLogoPreference()
	if (preference === "deepseek") return <BrandWordmark includeMark={false} />
	return <CocodeLogo variant="name" size={18} />
}

/** Hero mark: hide the fish for Cocode; DeepSeek keeps the official occupant. */
export function HeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
	const preference = useLogoPreference()
	if (preference === "cocode") return null
	return <FishLogo size={size} className={className} />
}
