import { useEffect, useState, type ReactNode } from "react"
import { AlertIcon, EmptyIcon } from "./icons.tsx"
import { t } from "./locales.ts"
import css from "./panel-state.module.css"

/** Normalize anything thrown by a request into displayable text. */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One-shot remote read shared by every panel: the request restarts whenever
 * `keys` change and is aborted on unmount, so a fast target switch cannot let
 * a stale response overwrite the current one.
 */
export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, keys: readonly unknown[]) {
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({ loading: true })
  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true })
    void load(controller.signal).then(
      value => setState({ value, loading: false }),
      error => { if (!controller.signal.aborted) setState({ error: message(error), loading: false }) },
    )
    return () => controller.abort()
  }, keys)
  return state
}

export interface StateAction {
  readonly label: string
  readonly onClick: () => void
}

/**
 * 面板缺省态。加载画骨架；出错与空共用同一张卡片——标记、标题、原因、至多一个
 * 脱困动作，让用户知道缺了什么以及下一步按哪里。
 */
export function State(props: {
  loading?: boolean
  /** 原始报错，作为标题下的细节呈现。 */
  error?: string
  /** 空态标题：缺了什么。 */
  empty?: string
  /** 补充说明：为什么重要，或如何补上。 */
  hint?: string
  /** 面板自己的图标，比通用占位更能说明这是哪块区域。 */
  icon?: ReactNode
  action?: StateAction
}) {
  if (props.loading === true) {
    return <div className={css.state}>
      <div className={css.skeleton} aria-busy="true" aria-label={t("common.loading")}>
        <span className={css.line} />
        <span className={css.line} />
        <span className={css.line} />
      </div>
    </div>
  }

  const failed = props.error !== undefined
  if (!failed && props.empty === undefined) return null

  return <div className={css.state}>
    <div className={css.card} data-tone={failed ? "error" : undefined}>
      <span className={css.mark}>{failed ? <AlertIcon size={18} /> : props.icon ?? <EmptyIcon size={18} />}</span>
      <span className={css.title}>{failed ? t("common.failed") : props.empty}</span>
      {failed && <span className={css.detail}>{props.error}</span>}
      {props.hint !== undefined && <span className={css.hint}>{props.hint}</span>}
      {props.action !== undefined && <button type="button" className={css.action} onClick={props.action.onClick}>
        {props.action.label}
      </button>}
    </div>
  </div>
}
