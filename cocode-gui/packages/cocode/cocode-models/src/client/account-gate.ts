/**
 * Optional desktop account capability, as the Models page sees it.
 *
 * The hosted Cocode Nut route is provisioned and removed by the signed-in
 * Cocode account, never by hand. So once that account is gone the page must
 * stop presenting the route as a configured provider: a cleanup that failed or
 * is still queued would otherwise keep reading as a healthy, ready provider
 * with a stored key — the page would be reporting a state the user cannot own.
 *
 * A runtime without the desktop bridge (browser dev, a plain harness web host)
 * has no account to gate on, and keeps rendering exactly what the host reports.
 */

/** The phases the desktop account bridge publishes. */
type AccountPhase = 'signed-out' | 'signing-in' | 'provisioning' | 'signed-in' | 'error'

type AccountSnapshot = { readonly phase: AccountPhase }

type DesktopAccount = {
  snapshot(): Promise<AccountSnapshot>
  onChanged(listener: (snapshot: AccountSnapshot) => void): () => void
}

/** Provider ids reserved for the desktop account provisioning flow. */
const ACCOUNT_MANAGED_PROVIDER_IDS = new Set(['cocode-nut', 'cocode-cloud'])
export const ACCOUNT_MANAGED_PROVIDER_DISPLAY_NAME = 'Cocode'

/** Localized row-tag key for the provider identity shown in the Models list. */
export type ProviderTagKey = 'managedProvider' | 'customTag'

/**
 * Keep the account-owned label scoped to Cocode Nut. Other declared routes,
 * including any future account-managed route, retain the existing custom tag
 * until their product copy is explicitly changed.
 */
export function providerTagKey(
  provider: string,
  managed: boolean,
  declared: boolean,
): ProviderTagKey | undefined {
  if (managed && provider === 'cocode-nut') return 'managedProvider'
  return declared ? 'customTag' : undefined
}

/** Whether a provider route is owned by the Cocode account rather than the Models page. */
export function isAccountManagedProvider(provider: string): boolean {
  return ACCOUNT_MANAGED_PROVIDER_IDS.has(provider)
}

/** Human-facing label used for account-managed routes in model settings. */
export function providerDisplayName(provider: string, displayName: string): string {
  return isAccountManagedProvider(provider) ? ACCOUNT_MANAGED_PROVIDER_DISPLAY_NAME : displayName
}

/** Whether a settings address names an account-managed provider profile. */
export function isAccountManagedProviderPath(settingsNs: string, path: readonly string[]): boolean {
  return settingsNs === 'llm-pi-ai'
    && path.length === 2
    && path[0] === 'providers'
    && isAccountManagedProvider(path[1] ?? '')
}

function desktopAccount(): DesktopAccount | undefined {
  return (window as Window & { readonly desktopApi?: { readonly account?: DesktopAccount } })
    .desktopApi?.account
}

/** The phases that own a provisioned hosted route. */
function ownsHostedRoute(phase: AccountPhase): boolean {
  return phase === 'signed-in' || phase === 'provisioning'
}

/**
 * Tracks whether account-managed provider rows belong on the page.
 *
 * It answers `true` until the desktop account says otherwise: the gate exists
 * to drop a route the user no longer owns, so being one tick late costs
 * nothing, while hiding a legitimate route during startup would flicker.
 */
export class HostedProviderGate {
  private readonly account = desktopAccount()
  private visible = true
  private off: (() => void) | undefined
  private generation = 0

  /**
   * @param onChange - called whenever the answer changed.
   */
  constructor(private readonly onChange: () => void) {}

  /** Whether account-managed provider rows belong on the page right now. */
  allowed = (): boolean => this.visible

  /** Start following the desktop account, when this runtime has one. */
  start(): void {
    const account = this.account
    if (account === undefined || this.off !== undefined) return
    const generation = ++this.generation
    let eventSequence = 0
    this.off = account.onChanged((snapshot) => {
      if (generation !== this.generation) return
      eventSequence += 1
      this.set(ownsHostedRoute(snapshot.phase))
    })
    const snapshotSequence = eventSequence
    void account.snapshot().then(
      (snapshot) => {
        if (generation === this.generation && snapshotSequence === eventSequence) {
          this.set(ownsHostedRoute(snapshot.phase))
        }
      },
      // An unreachable bridge says nothing about the account, so the host's own
      // view of the provider directory remains the best answer available.
      () => {
        if (generation === this.generation && snapshotSequence === eventSequence) this.set(true)
      },
    )
  }

  dispose(): void {
    this.generation += 1
    this.off?.()
    this.off = undefined
  }

  private set(next: boolean): void {
    if (this.visible === next) return
    this.visible = next
    this.onChange()
  }
}
