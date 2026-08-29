import { useEffect, useState } from "react"
import css from "./chrome.module.css"

type RuntimeRecoveryState = "idle" | "recovering" | "ready" | "failed"
type RuntimeRecoveryDetail = {
  state: RuntimeRecoveryState
  attempt: number
  maxAttempts: number
  error?: { code: string; message: string }
}

/**
 * Desktop-only banner while the local DSH sidecar is reconnecting.
 * @returns the banner, or null while the runtime is healthy.
 */
export function RecoveryBanner(): React.ReactElement | null {
  const [detail, setDetail] = useState<RuntimeRecoveryDetail | null>(null)
  const [language, setLanguage] = useState(() => document.documentElement.lang)

  useEffect(() => {
    const root = document.documentElement
    const languageObserver = new MutationObserver(() => { setLanguage(root.lang) })
    languageObserver.observe(root, { attributes: true, attributeFilter: ["lang"] })
    const onState = (event: Event): void => {
      setDetail((event as CustomEvent<RuntimeRecoveryDetail>).detail)
    }
    window.addEventListener("cocode:dsh-runtime-recovery-state", onState)
    const initial = root.dataset.dshRuntimeState as RuntimeRecoveryState | undefined
    if (initial !== undefined && initial !== "idle" && initial !== "ready") {
      setDetail({ state: initial, attempt: 0, maxAttempts: 3 })
    }
    return () => {
      window.removeEventListener("cocode:dsh-runtime-recovery-state", onState)
      languageObserver.disconnect()
    }
  }, [])

  if (detail === null || detail.state === "idle" || detail.state === "ready") return null
  const failed = detail.state === "failed"
  const english = language.startsWith("en")
  const retry = (): void => {
    const desktop = (window as Window & {
      desktopApi?: { dsh?: { requestRecovery(request: { reason: "host_unreachable"; endpointGeneration: number }): Promise<unknown> } }
    }).desktopApi?.dsh
    if (desktop === undefined) return
    void desktop.requestRecovery({
      reason: "host_unreachable",
      endpointGeneration: (window as Window & { __DSH_DESKTOP_ENDPOINT_GENERATION__?: number }).__DSH_DESKTOP_ENDPOINT_GENERATION__ ?? 0,
    })
  }
  const diagnostics = (): void => {
    const api = (window as Window & {
      desktopApi?: { diagnostics?: { openLogFolder(): Promise<unknown> } }
    }).desktopApi?.diagnostics
    if (api !== undefined) void api.openLogFolder()
  }
  return (
    <div className={css.recoveryBanner} role={failed ? "alert" : "status"} aria-live="polite">
      <span>
        {failed
          ? english
            ? `Local runtime recovery failed (${String(detail.attempt)}/${String(detail.maxAttempts)})`
            : `本地运行时恢复失败（${String(detail.attempt)}/${String(detail.maxAttempts)}）`
          : english ? "Recovering the local runtime; new actions are temporarily disabled…" : "正在恢复本地运行时，暂时禁止发送新操作…"}
        {failed && detail.error?.message !== undefined ? `：${detail.error.message}` : ""}
      </span>
      {failed && <button type="button" onClick={retry}>{english ? "Retry recovery" : "重试恢复"}</button>}
      {failed && <button type="button" onClick={diagnostics}>{english ? "Open diagnostics" : "打开诊断"}</button>}
    </div>
  )
}
