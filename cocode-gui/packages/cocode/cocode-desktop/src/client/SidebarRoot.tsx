import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import clsx from "clsx"
import {
	BrandWordmark,
	FishLogo,
	IconNewChatOutline16,
	IconPanelLeftOutline16,
	Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives"
import type { SidebarRootComponentProps } from "@deepseek-ai/dsh-client-ui-sidebar/client"
import { CocodeLogo } from "./CocodeLogo.tsx"
import css from "./SidebarRoot.module.css"

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/** How long the sidebar scrollbar remains visible after pointer exit. */
const SCROLLBAR_LINGER_MS = 2000

type LogoPreference = "cocode" | "deepseek"

function readLogoPreference(): LogoPreference {
	if (typeof document !== "undefined") {
		const datasetPreference = document.documentElement.dataset.cocodeLogo
		if (datasetPreference === "deepseek") return datasetPreference
		try {
			if (window.localStorage.getItem("cocode.logo.preference") === "deepseek") return "deepseek"
		} catch {
			// Private or locked-down storage falls back to the product logo.
		}
	}
	return "cocode"
}

function subscribeLogoPreference(listener: () => void): () => void {
	if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {}
	const observer = new MutationObserver(listener)
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-cocode-logo"],
	})
	return () => observer.disconnect()
}

/** Read the Cocode brand setting without coupling this shell to another plugin bundle. */
function useLogoPreference(): LogoPreference {
	return useSyncExternalStore(subscribeLogoPreference, readLogoPreference, () => "cocode")
}

/**
 * Cocode's sidebar shell, restored from the `62686e0` geometry contract.
 * The surrounding DSH package still owns the slot registry and services;
 * this occupant owns only the visual shell and its fold transition.
 */
export function SidebarRoot({
	collapsed,
	width,
	startSession,
	toggleSidebar,
	t,
	renderSlot,
}: SidebarRootComponentProps) {
	const logoPreference = useLogoPreference()
	const [settled, setSettled] = useState(collapsed)
	useEffect(() => {
		if (!collapsed) {
			setSettled(false)
			return
		}
		const timer = window.setTimeout(() => setSettled(true), COLLAPSE_SETTLE_MS)
		return () => window.clearTimeout(timer)
	}, [collapsed])
	const wide = !collapsed || !settled

	const lastWideWidth = useRef(width)
	if (!collapsed) lastWideWidth.current = width
	const everWide = useRef(!collapsed)
	if (!collapsed) everWide.current = true

	const column = useRef<HTMLDivElement>(null)
	const [pointerInside, setPointerInside] = useState(false)
	const lingerTimer = useRef<number | undefined>(undefined)
	const armLinger = (): void => {
		if (lingerTimer.current !== undefined) return
		lingerTimer.current = window.setTimeout(() => {
			lingerTimer.current = undefined
			setPointerInside(false)
		}, SCROLLBAR_LINGER_MS)
	}
	const cancelLinger = (): void => {
		window.clearTimeout(lingerTimer.current)
		lingerTimer.current = undefined
	}

	useEffect(() => {
		if (!pointerInside) return
		const onMove = (event: PointerEvent): void => {
			const rect = column.current?.getBoundingClientRect()
			if (rect === undefined) return
			const inside = event.clientX >= rect.left && event.clientX < rect.right
				&& event.clientY >= rect.top && event.clientY < rect.bottom
			if (inside) cancelLinger()
			else armLinger()
		}
		document.addEventListener("pointermove", onMove)
		return () => {
			document.removeEventListener("pointermove", onMove)
			cancelLinger()
		}
	}, [pointerInside])

	return (
		<div
			ref={column}
			className={clsx(
				css.root,
				!wide && css.collapsed,
				!wide && everWide.current && css.railIn,
				collapsed && wide && css.fading,
				!pointerInside && css.quietBars,
			)}
			style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
			onPointerEnter={() => {
				cancelLinger()
				setPointerInside(true)
			}}
			onPointerLeave={() => armLinger()}
		>
			<div className={css.titlebarDragRegion} data-desktop-titlebar-drag aria-hidden="true" />
			<div className={css.logoRow}>
				{wide && (
					<button
						type="button"
						className={clsx(css.brand, css.wide)}
							aria-label={t("session.new.label")}
							onClick={() => startSession()}
						>
							{logoPreference === "cocode"
								? <CocodeLogo className={css.brandLogo} size={18} />
								: <BrandWordmark className={css.brandLogo} size={18} />}
						</button>
					)}
				<Tooltip label={collapsed ? t("toggle.open") : t("toggle.collapse")} delayMs={500}>
					<button
						type="button"
						className={clsx(css.iconButton, css.toggle)}
						aria-label={collapsed ? t("toggle.open") : t("toggle.collapse")}
						onClick={() => toggleSidebar()}
					>
						{!wide && (logoPreference === "cocode"
							? <CocodeLogo className={clsx(css.railLogo, css.cocodeRailLogo)} variant="mark" size={18} />
							: <FishLogo className={css.railLogo} size={24} />)}
						<IconPanelLeftOutline16 className={css.panelIcon} size={wide ? 16 : 18} />
					</button>
				</Tooltip>
			</div>

			<Tooltip label={t("session.new.label")} delayMs={500} disabled={wide}>
				<button
					type="button"
					className={css.newSession}
					aria-label={t("session.new.label")}
					onClick={() => startSession()}
				>
					<IconNewChatOutline16 size={wide ? 14 : 18} />
					{wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t("session.new")}</span>}
				</button>
			</Tooltip>

			<div className={css.regionArea}>
				{renderSlot("sidebar.workspaces", {
					wide,
					expandSidebar: () => {
						if (collapsed) toggleSidebar()
					},
				})}
			</div>

			<div className={css.footArea}>
				<div className={css.footerActions}>{renderSlot("sidebar.footer.action", { wide })}</div>
				<div className={css.settingsArea}>{renderSlot("sidebar.settings", { wide })}</div>
			</div>
		</div>
	)
}
