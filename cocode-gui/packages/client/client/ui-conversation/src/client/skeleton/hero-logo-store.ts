import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { LogoPreference } from '@deepseek-ai/dsh-client-ui-theme/client'

export interface HeroLogoState {
  logoPreference: LogoPreference
  revision: number
}

type HeroLogoActions = {
  sync: (draft: HeroLogoState, logoPreference: LogoPreference, revision: number) => void
}

/** Mirror the appearance service's logo preference into the hero chrome. */
export function createHeroLogoStore(): EngineStoreHandle<HeroLogoState, HeroLogoActions> {
  return defineStore({
    init: (): HeroLogoState => ({ logoPreference: 'cocode', revision: -1 }),
    actions: {
      sync: (draft, logoPreference, revision) => {
        if (revision <= draft.revision) return
        draft.logoPreference = logoPreference
        draft.revision = revision
      },
    },
  })
}
