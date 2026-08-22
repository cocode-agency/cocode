import { createElement, Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import type { ConfigurableProviderView, ConnectionHandle } from "@deepseek-ai/dsh-api-remotes/client"
import type {} from "@deepseek-ai/dsh-client-locale/client"
import type {} from "@deepseek-ai/dsh-api-remotes/client"
import {
  IconChevronUpOutline14,
  IconSettingsOutline16,
  IconUserOutline16,
  Menu,
  type MenuEntry,
} from "@deepseek-ai/dsh-client-ui-primitives"
import { createAccountLocaleStore, type AccountLocale } from "./account-locale-store.ts"
import css from "./account.module.css"

type AccountSnapshot = {
  phase: "signed-out" | "signing-in" | "provisioning" | "signed-in" | "error"
  profile: { displayName: string; email?: string } | null
  cloud: { status: "absent" | "ready" | "conflict" | "error"; providerId: "cocode-nut" }
  usage?: { plan?: string; fiveHour?: number; week?: number; month?: number; currentPeriodEnd?: string; fiveHourResetAt?: string; weekResetAt?: string; syncedAt?: string; error?: string }
  error?: { code: string; message: string }
}

type DesktopAccountApi = {
  snapshot(): Promise<AccountSnapshot>
  signIn(): Promise<AccountSnapshot>
  cancelSignIn(): Promise<void>
  signOut(): Promise<void>
  onChanged(listener: (snapshot: AccountSnapshot) => void): () => void
}

declare global {
  interface Window {
    readonly desktopApi?: { readonly account?: DesktopAccountApi }
  }
}

type ProviderSummary = { readonly id: string; readonly name: string }

type AccountProps = {
  readonly wide: boolean
  readonly store: AccountStore
  readonly providers: ProviderStore
  readonly locale?: AccountLocale
}

type AccountPanelKind = "usage" | "help"

const FEEDBACK_TO = "support@cocode.agency"
let activeLocale: "zh" | "en" = "zh"

type OnboardingProps = {
  readonly complete: () => void
  readonly openSection: (id: string) => void
  readonly store: AccountStore
}

const EMPTY: AccountSnapshot = {
  phase: "signed-out",
  profile: null,
  cloud: { status: "absent", providerId: "cocode-nut" },
}

const COPY = {
  zh: {
    signIn: "登录 Cocode",
    settingsOrSignIn: "设置或登录 Cocode",
    signInTitle: "登录 Cocode 账号",
    signOutTitle: "退出 Cocode 账号",
    waiting: "等待授权…",
    provisioning: "配置 Cocode Nut…",
    retry: "重试 Cocode",
    browserHint: "已在系统浏览器中打开授权页面，完成后会自动继续。",
    provisioningHint: "正在为你的账号配置 Cocode Nut 云模型，稍等片刻。",
    onboardingTitle: "登录 Cocode",
    onboardingAction: "立即登录",
    cancelSignIn: "取消登录",
    signInErrorTitle: "登录 Cocode 失败",
    close: "关闭",
    retryLogin: "重试登录",
    intro: "登录后可直接使用账号内的云端模型，无需自行配置 Provider。你当前的默认模型保持不变。",
    later: "稍后再说",
    conflict: "本机已有同名 Provider 或凭证，请先在模型设置中处理冲突。",
    cleanupPending: "本地账号已退出，Cocode Nut 配置将在运行时恢复后继续清理。",
    reauthentication: "请在浏览器中重新认证 Cocode 账号（十分钟内完成），然后点击重试。",
    accountBusy: "另一个 Cocode 客户端正在更新账号，请稍后重试。异常退出留下的账号锁会在下次操作时自动恢复。",
    fileStorageUnavailable: "Cocode 账号文件不可用。请检查 COCODE_HOME 的权限和磁盘空间后重试。",
    accountUnavailable: "当前运行环境未连接 Cocode 账号服务，请重启桌面客户端后重试。",
    account: "Cocode 账号",
    accountPlan: "账户与计划",
    planUsage: "套餐用量",
    customProvider: "自定义 Provider",
    noProvider: "登录或配置 Provider",
    models: "模型与 Provider",
    settings: "设置",
    help: "帮助与反馈",
    signOut: "退出登录",
    providerId: "Provider ID：",
    waitData: "等待数据",
    resettingSoon: "即将重置",
    resetIn: "约 {value} 后重置",
    syncFailed: "同步失败：{message}",
    syncingUsage: "正在同步账号用量…",
    usageSynced: "账号用量已同步",
    updatedAt: "更新于 {time}",
    currentProvider: "当前 Provider",
    currentPlan: "当前套餐",
    remaining: "剩余",
    rollingReset: "滚动窗口，等待重置时间",
    periodEnds: "当前周期到期：{time}",
    usageHint: "百分比代表当前周期剩余额度。本地 Provider 的请求不会计入 Cocode Nut 用量。",
    cloudProvider: "账号云模型与 Cocode Nut 服务",
    localProvider: "本地 Provider 与凭证配置",
    cloudHelp: "Cocode Nut 的账号、套餐和云模型问题，可以先打开个人中心；模型选择和本地配置仍在模型设置中管理。",
    localHelp: "当前使用的是本地 Provider。连接、模型不可用或凭证问题，可以从 Provider 设置开始排查。",
    openAccountCenter: "打开 Cocode 个人中心",
    openDocs: "访问 Cocode 文档",
    feedbackMail: "反馈邮件",
  },
  en: {
    signIn: "Sign in to Cocode",
    settingsOrSignIn: "Settings or sign in to Cocode",
    signInTitle: "Sign in to your Cocode account",
    signOutTitle: "Sign out of your Cocode account",
    waiting: "Waiting for authorization…",
    provisioning: "Configuring Cocode Nut…",
    retry: "Retry Cocode",
    browserHint: "The authorization page is open in your browser. This continues automatically once you finish.",
    provisioningHint: "Setting up Cocode Nut cloud models for your account. This takes a moment.",
    onboardingTitle: "Sign in to Cocode",
    onboardingAction: "Sign in",
    cancelSignIn: "Cancel sign-in",
    signInErrorTitle: "Cocode sign-in failed",
    close: "Close",
    retryLogin: "Retry sign-in",
    intro: "Sign in to use the cloud models included with your account — no provider setup needed. Your current default model stays unchanged.",
    later: "Not now",
    conflict: "A provider or credential with the reserved Cocode name already exists. Resolve it in Models settings first.",
    cleanupPending: "The local account is signed out. Cloud configuration cleanup will resume when the runtime is available.",
    reauthentication: "Reauthenticate your Cocode account in the browser within ten minutes, then retry.",
    accountBusy: "Another Cocode client is updating the account. Retry shortly; locks left by a crashed client recover automatically.",
    fileStorageUnavailable: "Cocode account files are unavailable. Check COCODE_HOME permissions and free disk space, then retry.",
    accountUnavailable: "The Cocode account service is unavailable in this window. Restart the desktop client and try again.",
    account: "Cocode account",
    accountPlan: "Account & plan",
    planUsage: "Plan usage",
    customProvider: "Custom provider",
    noProvider: "Sign in or configure a provider",
    models: "Models & providers",
    settings: "Settings",
    help: "Help & feedback",
    signOut: "Sign out",
    providerId: "Provider ID: ",
    waitData: "Waiting for data",
    resettingSoon: "Resetting soon",
    resetIn: "Resets in about {value}",
    syncFailed: "Sync failed: {message}",
    syncingUsage: "Syncing account usage…",
    usageSynced: "Account usage synced",
    updatedAt: "Updated {time}",
    currentProvider: "Current provider",
    currentPlan: "Current plan",
    remaining: "remaining",
    rollingReset: "Rolling window; reset time is unavailable",
    periodEnds: "Current period ends {time}",
    usageHint: "Percentages show the remaining allowance for the current period. Local provider requests are not counted toward Cocode Nut usage.",
    cloudProvider: "Account cloud models and Cocode Nut service",
    localProvider: "Local provider and credential configuration",
    cloudHelp: "For Cocode Nut account, plan, or cloud-model issues, open the account center first. Model selection and local configuration remain in Models settings.",
    localHelp: "You are using a local provider. Start with provider settings when a connection, model, or credential is unavailable.",
    openAccountCenter: "Open Cocode account center",
    openDocs: "Open Cocode documentation",
    feedbackMail: "Feedback email",
  },
} as const
type AccountCopy = typeof COPY.zh | typeof COPY.en

function copy(): typeof COPY.zh | typeof COPY.en {
  return activeLocale === "en" ? COPY.en : COPY.zh
}

class AccountStore {
  private snapshot = EMPTY
  private listeners = new Set<() => void>()
  private off: (() => void) | undefined
  private busy = false

  getSnapshot = (): AccountSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.start()
    return () => this.listeners.delete(listener)
  }

  async activate(): Promise<void> {
    if (this.busy) return
    const account = window.desktopApi?.account
    if (account === undefined) {
      this.set({
        ...this.snapshot,
        phase: "error",
        error: {
          code: "account-unavailable",
          message: copy().accountUnavailable,
        },
      })
      return
    }
    this.busy = true
    this.set({
      phase: "signing-in",
      profile: null,
      cloud: { status: "absent", providerId: "cocode-nut" },
    })
    try {
      this.set(await account.signIn())
    } catch (error) {
      this.set({ ...this.snapshot, phase: "error", error: { code: "sign-in-failed", message: safeMessage(error) } })
    } finally {
      this.busy = false
    }
  }

  /**
   * Abandon a sign-in that is waiting on the browser. This deliberately ignores
   * `busy`: that flag is raised for the whole browser round trip, so honouring
   * it here would make the only way out of the wait unreachable.
   */
  async cancel(): Promise<void> {
    await window.desktopApi?.account?.cancelSignIn()
  }

  async retry(): Promise<void> {
    if (this.snapshot.error?.code !== "cleanup-pending") {
      await this.activate()
      return
    }
    if (this.busy) return
    const account = window.desktopApi?.account
    if (account === undefined) return
    this.busy = true
    try {
      await account.signOut()
      this.set(await account.snapshot())
    } catch (error) {
      this.set({ ...this.snapshot, phase: "error", error: { code: "cleanup-pending", message: safeMessage(error) } })
    } finally {
      this.busy = false
    }
  }

  async deactivate(): Promise<void> {
    if (this.busy) return
    const account = window.desktopApi?.account
    if (account === undefined) return
    this.busy = true
    try {
      await account.signOut()
      this.set(await account.snapshot())
    } catch (error) {
      this.set({ ...this.snapshot, phase: "error", error: { code: "sign-out-failed", message: safeMessage(error) } })
    } finally {
      this.busy = false
    }
  }

  async refresh(): Promise<void> {
    const account = window.desktopApi?.account
    if (account === undefined) return
    try {
      this.set(await account.snapshot())
    } catch (error) {
      this.set({ ...this.snapshot, usage: { ...this.snapshot.usage, error: safeMessage(error) } })
    }
  }

  dispose(): void {
    this.off?.()
    this.off = undefined
    this.listeners.clear()
  }

  private start(): void {
    if (this.off !== undefined) return
    const account = window.desktopApi?.account
    if (account === undefined) return
    this.off = account.onChanged(snapshot => this.set(snapshot))
    void account.snapshot().then(snapshot => this.set(snapshot), error => {
      this.set({ ...EMPTY, phase: "error", error: { code: "account-unavailable", message: safeMessage(error) } })
    })
  }

  private set(snapshot: AccountSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }
}

class ProviderStore {
  private snapshot: ProviderSummary | null = null
  private providers: readonly ConfigurableProviderView[] = []
  private listeners = new Set<() => void>()
  private generation = 0

  constructor(private readonly connection: ConnectionHandle) {}

  getSnapshot = (): ProviderSummary | null => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  refreshSelection(): void {
    this.publish(this.select(this.providers))
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    try {
      const response = await this.connection.api.llm.providers({})
      if (!response.result.ok || generation !== this.generation) return
      this.providers = response.result.value.providers
      this.publish(this.select(this.providers))
    } catch {
      // Keep the last confirmed provider while the runtime reconnects.
    }
  }

  private select(providers: readonly ConfigurableProviderView[]): ProviderSummary | null {
    const active = providers.filter(provider => provider.active)
    const preferred = this.connection.hostDescription.getSnapshot()?.provider
    const provider = active.find(candidate => candidate.provider === preferred)
      ?? active.find(candidate => candidate.provider !== "cocode-nut")
      ?? active[0]
    return provider === undefined ? null : { id: provider.provider, name: provider.displayName }
  }

  private publish(next: ProviderSummary | null): void {
    if (this.snapshot?.id === next?.id && this.snapshot?.name === next?.name) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/ck_[A-Za-z0-9_-]+/g, "[redacted]")
}

/**
 * The cocode.agency brand mark: the 'c' glyph of the ASCII wordmark, drawn as
 * half/full cells on a 10x16 grid so it stays pixel-crisp at any size. The
 * harness ui-primitives build shipped to plugins does not export the sidebar's
 * logo, so the glyph data lives here rather than crossing that package edge.
 */
const MARK_LINES = [" ▄█████", " ██", " ██", " ▀█████"] as const
const MARK_COLUMNS = 7
const MARK_CELL_WIDTH = 10
const MARK_ROW_HEIGHT = 16

function CocodeMark({ size }: { readonly size: number }): ReturnType<typeof createElement> {
  const cells = MARK_LINES.flatMap((line, row) => [...line].flatMap((glyph, column) => {
    const key = `${row}-${column}`
    const x = column * MARK_CELL_WIDTH
    const y = row * MARK_ROW_HEIGHT
    const half = MARK_ROW_HEIGHT / 2
    if (glyph === "█") return [createElement("rect", { key, x, y, width: MARK_CELL_WIDTH, height: MARK_ROW_HEIGHT })]
    if (glyph === "▄") return [createElement("rect", { key, x, y: y + half, width: MARK_CELL_WIDTH, height: half })]
    if (glyph === "▀") return [createElement("rect", { key, x, y, width: MARK_CELL_WIDTH, height: half })]
    return []
  }))
  const gridWidth = MARK_COLUMNS * MARK_CELL_WIDTH
  const gridHeight = MARK_LINES.length * MARK_ROW_HEIGHT
  return createElement(
    "svg",
    {
      width: (size * gridWidth) / gridHeight,
      height: size,
      viewBox: `0 0 ${gridWidth} ${gridHeight}`,
      shapeRendering: "crispEdges",
      "aria-hidden": true,
    },
    createElement("g", { fill: "currentColor" }, cells),
  )
}

function accountError(snapshot: AccountSnapshot): string | undefined {
  const t = copy()
  if (snapshot.error?.code === "cloud-provider-conflict") return t.conflict
  if (snapshot.error?.code === "cleanup-pending") return t.cleanupPending
  if (snapshot.error?.code === "reauthentication-required") return t.reauthentication
  if (snapshot.error?.code === "ACCOUNT_BUSY") return t.accountBusy
  if (snapshot.error?.code === "FILE_STORAGE_UNAVAILABLE") return t.fileStorageUnavailable
  return snapshot.error?.message
}

function AccountOnboarding({ complete, openSection, store }: OnboardingProps): ReactNode {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const t = copy()
  const completed = useRef(false)
  useEffect(() => {
    if (snapshot.phase === "signed-in" && !completed.current) {
      completed.current = true
      complete()
    }
  }, [complete, snapshot.phase])
  if (snapshot.phase === "signed-in") {
    return null
  }
  const busy = snapshot.phase === "signing-in" || snapshot.phase === "provisioning"
  // Only the browser round trip is worth interrupting. Provisioning writes the
  // cloud route and credential and needs no user input, so it is dismissed
  // rather than aborted: tearing it down halfway would leave a partial route.
  const cancellable = snapshot.phase === "signing-in"
  const dismiss = (): void => {
    if (!busy) openSection("models")
    complete()
  }
  const message = snapshot.phase === "signing-in"
    ? t.browserHint
    : snapshot.phase === "provisioning"
      ? t.provisioningHint
      : t.intro
  return createElement(
    "div",
    { className: css.onboardingOverlay, role: "presentation" },
    createElement(
      "section",
      { className: css.onboardingCard, role: "dialog", "aria-modal": "true", "aria-label": t.onboardingTitle },
      createElement("span", { className: css.onboardingMark }, createElement(CocodeMark, { size: 18 })),
      createElement("h2", { className: css.onboardingTitle }, t.onboardingTitle),
      createElement(
        "p",
        { className: css.onboardingIntro },
        busy ? createElement("span", { className: css.onboardingSpinner, "aria-hidden": true }) : null,
        createElement("span", null, message),
      ),
      snapshot.error === undefined ? null : createElement("p", { role: "alert", className: css.onboardingError }, accountError(snapshot)),
      createElement(
        "div",
        { className: css.onboardingActions },
        // This card is a full-screen modal, so the secondary action is the only
        // way out of it and must never be disabled: an authorization wait lasts
        // until the user finishes in the browser, and blocking the window for
        // that whole time leaves no way to abandon the attempt.
        createElement("button", {
          type: "button",
          className: `${css.onboardingButton} ${css.onboardingGhost}`,
          onClick: cancellable ? () => { void store.cancel() } : dismiss,
        }, cancellable ? t.cancelSignIn : t.later),
        createElement("button", {
          type: "button",
          className: `${css.onboardingButton} ${css.onboardingPrimary}`,
          onClick: () => { void store.retry() },
          disabled: busy,
        }, busy ? t.waiting : t.onboardingAction),
      ),
    ),
  )
}

function requestSettings(sectionId?: string): void {
  window.dispatchEvent(new CustomEvent("cocode:open-settings", {
    detail: sectionId === undefined ? {} : { sectionId },
  }))
}

function initialOf(value: string): string {
  return [...value.trim()][0]?.toUpperCase() ?? "C"
}

const ACCOUNT_CENTER_URL = "https://cocode.agency/account"

function openAccountCenter(): void {
  window.open(ACCOUNT_CENTER_URL, "_blank", "noopener,noreferrer")
}

function snapshotUsage(snapshot: AccountSnapshot, key: "fiveHour" | "week" | "month"): number | undefined {
  return snapshot.usage?.[key]
}

function remainingUsagePercent(used: number | undefined): number | undefined {
  if (typeof used !== "number" || !Number.isFinite(used)) return undefined
  return Math.max(0, Math.min(100, 100 - used))
}

function formatRemainingPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

function formatDateTime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatTimeUntil(value: string | undefined, t: AccountCopy, now = Date.now()): string {
  if (value === undefined) return t.waitData
  const target = new Date(value).getTime()
  if (!Number.isFinite(target)) return t.waitData
  const remaining = target - now
  if (remaining <= 0) return t.resettingSoon
  const minutes = Math.ceil(remaining / 60_000)
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  const mins = minutes % 60
  const valueText = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return t.resetIn.replace('{value}', valueText)
}

function usageSyncLabel(snapshot: AccountSnapshot, t: AccountCopy): string {
  if (snapshot.usage?.error !== undefined) return t.syncFailed.replace('{message}', snapshot.usage.error)
  if (snapshot.usage?.syncedAt === undefined) return t.syncingUsage
  const date = new Date(snapshot.usage.syncedAt)
  return Number.isNaN(date.getTime()) ? t.usageSynced : t.updatedAt.replace('{time}', date.toLocaleString())
}

type MenuGlyphKind = "account" | "usage" | "settings" | "help" | "logout"

function MenuGlyph({ kind }: { readonly kind: MenuGlyphKind }): ReturnType<typeof createElement> {
  const paths: Record<MenuGlyphKind, ReturnType<typeof createElement>> = {
    account: createElement("path", { d: "M3 13.5c.7-1.9 2.5-3 5-3s4.3 1.1 5 3M8 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" }),
    usage: createElement("path", { d: "M3 13V9.5M6.5 13V6.5M10 13V3M13.5 13V8M2 13.5h12" }),
    settings: createElement("g", null,
      createElement("path", { d: "m6.55 2.05.35 1.42a4.9 4.9 0 0 0-1.26.73l-1.36-.56-1.28 2.22 1.01.99a4.8 4.8 0 0 0 0 1.46L3 9.3l1.28 2.22 1.36-.56a4.9 4.9 0 0 0 1.26.73l-.35 1.42h2.56l-.35-1.42a4.9 4.9 0 0 0 1.26-.73l1.36.56 1.28-2.22-1.01-.99a4.8 4.8 0 0 0 0-1.46l1.01-.99-1.28-2.22-1.36.56a4.9 4.9 0 0 0-1.26-.73l.35-1.42Z" }),
      createElement("circle", { cx: 8, cy: 7.58, r: 1.65 }),
    ),
    help: createElement("path", { d: "M5.9 5.8a2.15 2.15 0 1 1 3.65 1.54c-.9.78-1.55 1.15-1.55 2.16M8 12.25v.1" }),
    logout: createElement("path", { d: "M8.5 3H4.25A1.25 1.25 0 0 0 3 4.25v7.5A1.25 1.25 0 0 0 4.25 13H8.5M9 8h5M11.5 5.5 14 8l-2.5 2.5" }),
  }
  return createElement("svg", { className: css.menuGlyph, viewBox: "0 0 16 16", width: 16, height: 16, fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": true }, paths[kind])
}

function AccountPanel({ kind, snapshot, provider, onClose }: {
  readonly kind: AccountPanelKind
  readonly snapshot: AccountSnapshot
  readonly provider: ProviderSummary | null
  readonly onClose: () => void
}): ReturnType<typeof createElement> {
  const t = copy()
  const [, refreshClock] = useState(() => Date.now())
  useEffect(() => {
    if (kind !== "usage") return
    const timer = window.setInterval(() => refreshClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [kind])
  const title = kind === "usage" ? t.planUsage : t.help
  const isCloud = provider?.id === "cocode-nut"
    || (provider === null && (snapshot.cloud.status === "ready" || snapshot.cloud.status === "conflict"))
  const providerLabel = isCloud ? "Cocode Nut" : provider?.name ?? t.currentProvider
  const usageMetric = (label: string, value: number | undefined, resetAt: string | undefined): ReturnType<typeof createElement> => {
    const percentage = remainingUsagePercent(value)
    return createElement("div", { className: css.usageMetric },
      createElement("div", { className: css.usageMetricHeader },
        createElement("span", { className: css.usageMetricLabel }, label),
        createElement("strong", { className: css.usageMetricPercent }, percentage === undefined ? "—" : `${formatRemainingPercent(percentage)} ${t.remaining}`),
      ),
      createElement("div", { className: css.usageTrack }, createElement("span", { className: css.usageFill, style: { width: `${percentage ?? 0}%` } })),
      createElement("span", { className: css.usageReset }, percentage === undefined
        ? (snapshot.usage?.error === undefined ? t.syncingUsage : t.syncFailed.replace('{message}', ''))
        : resetAt === undefined ? t.rollingReset : formatTimeUntil(resetAt, t)),
    )
  }
  const body = kind === "usage"
      ? createElement("div", { className: css.panelStack },
          createElement("div", { className: css.planCard },
            createElement("span", { className: css.panelEyebrow }, t.currentPlan),
            createElement("strong", { className: css.planName }, snapshot.usage?.plan?.toUpperCase() ?? (snapshot.usage?.error === undefined ? t.syncingUsage : t.syncFailed.replace('{message}', ''))),
            createElement("span", { className: css.panelSecondary }, snapshot.usage?.currentPeriodEnd === undefined
              ? usageSyncLabel(snapshot, t)
              : t.periodEnds.replace('{time}', formatDateTime(snapshot.usage.currentPeriodEnd) ?? t.waitData)),
          ),
          createElement("div", { className: css.usageGrid },
            usageMetric(t === COPY.en ? "5-hour limit" : "5 小时限额", snapshotUsage(snapshot, "fiveHour"), snapshot.usage?.fiveHourResetAt),
            usageMetric(t === COPY.en ? "Weekly limit" : "周限额", snapshotUsage(snapshot, "week"), snapshot.usage?.weekResetAt),
            usageMetric(t === COPY.en ? "Monthly limit" : "月限额", snapshotUsage(snapshot, "month"), snapshot.usage?.currentPeriodEnd),
          ),
          createElement("p", { className: css.panelHint }, t.usageHint),
        )
      : createElement("div", { className: css.panelStack },
          createElement("div", { className: css.providerHelpCard },
            createElement("span", { className: css.panelEyebrow }, t.currentProvider),
            createElement("strong", { className: css.planName }, providerLabel),
            createElement("span", { className: css.panelSecondary }, isCloud ? t.cloudProvider : t.localProvider),
          ),
          createElement("p", { className: css.panelIntro }, isCloud
            ? t.cloudHelp
            : t.localHelp),
          isCloud ? createElement("a", { className: css.panelAction, href: ACCOUNT_CENTER_URL, target: "_blank", rel: "noreferrer" }, t.openAccountCenter) : null,
          createElement("a", { className: css.panelAction, href: "https://doc.cocode.agency", target: "_blank", rel: "noreferrer" }, t.openDocs),
          createElement("a", { className: css.feedbackDraft, href: `mailto:${FEEDBACK_TO}` },
            createElement("strong", null, t.feedbackMail),
            createElement("span", { className: css.feedbackAddress }, FEEDBACK_TO),
          ),
        )
  return createElement("div", { className: css.panelOverlay, role: "presentation", onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose() } },
    createElement("section", { className: css.panel, role: "dialog", "aria-modal": "true", "aria-label": title },
      createElement("header", { className: css.panelHeader },
        createElement("h2", { className: css.panelTitle }, title),
        createElement("button", { type: "button", className: css.panelClose, onClick: onClose, "aria-label": t.close }, "×"),
      ),
      body,
    ),
  )
}

function AccountErrorModal({ snapshot, onClose, onRetry }: {
  readonly snapshot: AccountSnapshot
  readonly onClose: () => void
  readonly onRetry: () => void
}): ReturnType<typeof createElement> {
  const t = copy()
  return createElement("div", {
    className: css.panelOverlay,
    role: "presentation",
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose() },
  },
  createElement("section", { className: css.panel, role: "alertdialog", "aria-modal": "true", "aria-label": t.signInErrorTitle },
    createElement("header", { className: css.panelHeader },
      createElement("h2", { className: css.panelTitle }, t.signInErrorTitle),
      createElement("button", { type: "button", className: css.panelClose, onClick: onClose, "aria-label": t.close }, "×"),
    ),
    createElement("div", { className: css.panelStack },
      createElement("p", { className: css.onboardingError, role: "alert" }, accountError(snapshot)),
      createElement("div", { className: css.onboardingActions },
        createElement("button", { type: "button", className: `${css.onboardingButton} ${css.onboardingGhost}`, onClick: onClose }, t.close),
        createElement("button", { type: "button", className: `${css.onboardingButton} ${css.onboardingPrimary}`, onClick: onRetry }, t.retryLogin),
      ),
    ),
  ))
}

function AccountAction({ wide, store, providers, locale }: AccountProps): ReturnType<typeof createElement> {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const provider = useSyncExternalStore(providers.subscribe, providers.getSnapshot, providers.getSnapshot)
  const localeStore = useMemo(() => createAccountLocaleStore(locale), [locale])
  const localeSnapshot = useSyncExternalStore(
    localeStore.subscribe,
    localeStore.getSnapshot,
    localeStore.getSnapshot,
  )
  activeLocale = localeSnapshot.active === "en" ? "en" : "zh"
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<AccountPanelKind | null>(null)
  const [errorOpen, setErrorOpen] = useState(false)
  const previousPhase = useRef(snapshot.phase)
  const signedIn = snapshot.phase === "signed-in" || snapshot.phase === "provisioning"
  const t = localeSnapshot.active === "en" ? COPY.en : COPY.zh
  // Waiting on the browser lasts as long as the user takes there, so the
  // trigger stays open during it and the menu carries the way out. Provisioning
  // is short, bounded and not interruptible, so it keeps the trigger disabled.
  const cancellable = snapshot.phase === "signing-in"
  useEffect(() => {
    if (snapshot.phase === "error" && previousPhase.current !== "error") setErrorOpen(true)
    previousPhase.current = snapshot.phase
  }, [snapshot.phase])
  const primary = signedIn
    ? snapshot.profile?.displayName ?? "Cocode"
    : cancellable
      ? t.waiting
      : t.settingsOrSignIn
  const title = accountError(snapshot) ?? primary
  const entries: MenuEntry[] = cancellable
    ? [
        { type: "label", id: "signing-in", text: t.browserHint },
        { id: "cancel-sign-in", label: t.cancelSignIn, icon: createElement(MenuGlyph, { kind: "logout" }) },
      ]
    : signedIn
    ? [
        { id: "account", label: t.accountPlan, icon: createElement(MenuGlyph, { kind: "account" }) },
        { id: "usage", label: t.planUsage, icon: createElement(MenuGlyph, { kind: "usage" }) },
        { type: "separator", id: "account-separator" },
        { id: "settings", label: t.settings, icon: createElement(MenuGlyph, { kind: "settings" }) },
        { id: "help", label: t.help, icon: createElement(MenuGlyph, { kind: "help" }) },
        { id: "sign-out", label: t.signOut, danger: true, icon: createElement(MenuGlyph, { kind: "logout" }) },
      ]
    : provider === null
      ? [
          { type: "label", id: "identity", text: "Cocode" },
          { id: "sign-in", label: t.signIn, icon: createElement(IconUserOutline16, { size: 16 }) },
          { id: "models", label: t.models, icon: createElement(MenuGlyph, { kind: "usage" }) },
          { type: "separator", id: "settings-separator" },
          { id: "settings", label: t.settings, icon: createElement(MenuGlyph, { kind: "settings" }) },
        ]
      : [
          { type: "label", id: "provider", text: provider.name },
          ...(provider.id === provider.name
            ? []
            : [{ type: "label" as const, id: "provider-id", text: `${t.providerId}${provider.id}` }]),
          { type: "separator", id: "provider-separator" },
          { id: "models", label: t.models, icon: createElement(MenuGlyph, { kind: "usage" }) },
          { id: "help", label: t.help, icon: createElement(MenuGlyph, { kind: "help" }) },
          { id: "sign-in", label: t.signIn, icon: createElement(MenuGlyph, { kind: "account" }) },
          { id: "settings", label: t.settings, icon: createElement(MenuGlyph, { kind: "settings" }) },
        ]
  const select = (id: string): void => {
    setOpen(false)
    if (id === "sign-in") void store.activate()
    else if (id === "cancel-sign-in") void store.cancel()
    else if (id === "sign-out") void store.deactivate()
    else if (id === "models") requestSettings("models")
    else if (id === "settings") requestSettings()
    else if (id === "account") openAccountCenter()
    else if (id === "usage") {
      setPanel(id)
      void store.refresh()
    } else if (id === "help") setPanel(id)
  }
  return createElement(
    Fragment,
    null,
    createElement(
      Menu,
      {
        open,
        side: "top",
        align: "start",
        portal: true,
        dense: true,
        items: entries,
        onClose: () => { setOpen(false) },
        onSelect: select,
        className: `${css.actionRoot} ${wide ? "" : css.actionRootRail}`,
        anchor: createElement(
          "button",
          {
            type: "button",
            title,
            className: wide ? css.trigger : `${css.trigger} ${css.rail}`,
            "aria-haspopup": "menu",
            "aria-expanded": open,
            disabled: snapshot.phase === "provisioning",
            onClick: () => { setOpen(value => !value) },
          },
          createElement(
            "span",
            { className: `${css.avatar} ${signedIn ? css.accountAvatar : css.providerAvatar}` },
            signedIn
              ? initialOf(primary)
              : createElement(IconSettingsOutline16, { size: 18 }),
          ),
          wide && createElement(
            "span",
            { className: css.copy },
            createElement("span", { className: css.primary }, primary),
          ),
          wide && createElement(IconChevronUpOutline14, { className: css.chevron, size: 14 }),
        ),
      },
    ),
    panel === null ? null : createElement(AccountPanel, { kind: panel, snapshot, provider, onClose: () => setPanel(null) }),
    errorOpen ? createElement(AccountErrorModal, {
      snapshot,
      onClose: () => setErrorOpen(false),
      onRetry: () => { setErrorOpen(false); void store.activate() },
    }) : null,
  )
}

export const inject = ["slots", "connection", "remote", "locale"]

export function apply(ctx: ClientContext): void {
  const store = new AccountStore()
  const connection = ctx.get("connection") as ConnectionHandle
  const providers = new ProviderStore(connection)
  ctx.effect(() => () => store.dispose(), "cocode-account: dispose store")
  ctx.effect(() => {
    const refresh = (): void => { void providers.load() }
    const disposers = [
      connection.hostDescription.subscribe(() => { providers.refreshSelection() }),
      ctx.remote.$on("llm/adapters-updated", refresh),
      ctx.remote.$on("settings/document-updated", refresh),
      ctx.remote.$on("credentials/updated", refresh),
      ctx.on("connection/reset", refresh),
    ]
    refresh()
    return () => { for (const dispose of disposers) dispose() }
  }, "cocode-account: provider summary")
  const slots = ctx.slots as unknown as {
    inject(name: string, factory: () => unknown): unknown
    register(options: unknown, component: unknown): unknown
  }
  slots.inject("sidebar.footer.action", () => slots.register({
    name: "sidebar.footer.action",
    id: "cocode-account",
    order: -100,
    inject: () => ({ store, providers, locale: ctx.locale }),
  }, AccountAction))
  slots.inject("settings.onboarding", () => slots.register({
    name: "settings.onboarding",
    id: "cocode-account",
    order: -50,
    inject: () => ({ store }),
  }, AccountOnboarding))
}

// Keep the host plugin's default export shape compatible with older loaders.
export function mountStandalone(target: HTMLElement): () => void {
  const store = new AccountStore()
  const providers = new ProviderStore({
    api: { llm: { models: async () => ({ result: { ok: true, value: { groups: [], failures: [] } } }) } },
    hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as unknown as ConnectionHandle)
  let root: Root | undefined
  root = createRoot(target)
  root.render(createElement(AccountAction, { wide: true, store, providers }))
  return () => root?.unmount()
}
