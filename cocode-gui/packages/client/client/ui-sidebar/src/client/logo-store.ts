import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { LogoPreference } from '@deepseek-ai/dsh-client-ui-theme/client'

export interface SidebarLogoState {
  logoPreference: LogoPreference
  revision: number
}

type SidebarLogoActions = {
  sync: (draft: SidebarLogoState, logoPreference: LogoPreference, revision: number) => void
}

/** Mirror the appearance service's logo preference into the sidebar slot. */
export function createSidebarLogoStore(): EngineStoreHandle<SidebarLogoState, SidebarLogoActions> {
  return defineStore({
    init: (): SidebarLogoState => ({ logoPreference: 'cocode', revision: -1 }),
    actions: {
      sync: (draft, logoPreference, revision) => {
        if (revision <= draft.revision) return
        draft.logoPreference = logoPreference
        draft.revision = revision
      },
    },
  })
}
