import type { ClientContext, ISessions, SessionId } from "@deepseek-ai/dsh-client-runtime/client"
// Type-only: pulls in the locale plugin's Context merge (ctx.locale).
import type {} from "@deepseek-ai/dsh-client-locale/client"
import { DockSurface } from "./DockSurface.tsx"
import { Launcher } from "./Launcher.tsx"
import { GitHeroAction } from "./GitHeroAction.tsx"
import { WorkbenchController, type WorkbenchLayoutFace } from "./controller.ts"
import { builtInPanels } from "./builtins.tsx"
import { LOCALE_NS, attachLocale, en, zh, t, type WorkbenchKey } from "./locales.ts"
import { CommitModelRow } from "./settings-row.tsx"
import { CommandLineSection } from "./command-line-section.tsx"
import { DiagnosticsSection } from "./diagnostics-section.tsx"
import { VersionSection } from "./version-section.tsx"
import type { WorkbenchPanelProps } from "./model.ts"
import { fileMentionText } from "./file-mention.ts"
import { bindFileShortcutRegistry, fileShortcutCommands, type FileShortcutRegistryFace } from "./file-shortcuts.ts"

export type * from "./model.ts"
export { WorkbenchController } from "./controller.ts"

declare module "@deepseek-ai/cordis" {
  interface Context {
    workbench: import("./model.ts").WorkbenchService
    shortcuts: {
      register(command: {
        readonly id: string
        readonly title: string
        readonly description?: string
        readonly defaultCombo?: {
          readonly key: string
          readonly primary?: boolean
          readonly alt?: boolean
          readonly shift?: boolean
          readonly control?: boolean
        }
        readonly run: (event?: KeyboardEvent) => void | boolean
      }): () => void
    } & FileShortcutRegistryFace
  }
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** Workbench docks, panels and the source control surface. */
    cocodeWorkbench: WorkbenchKey
  }
}

export const inject = ["slots", "layout", "sessions", "locale", "shortcuts"]

interface ConversationInputInsertion {
  readonly input: {
    for(scope: Omit<ClientContext, "remote">): {
      insertDraftText(text: string): boolean
    }
  }
}

/** Route a file-tree action through the resident session composer input. */
function addFileToChat(ctx: ClientContext, sessionId: string, path: string): boolean {
  const sessions = ctx.get("sessions") as ISessions | undefined
  const scope = sessions?.scope(sessionId as SessionId)
  if (scope === undefined) return false
  const conversation = scope.get("conversation") as ConversationInputInsertion | undefined
  return conversation?.input.for(scope).insertDraftText(fileMentionText(path)) ?? false
}

export function apply(ctx: ClientContext): void {
  const layout = ctx.get("layout") as WorkbenchLayoutFace
  const sessions = ctx.get("sessions") as WorkbenchPanelProps["sessions"]
  // Panels render outside the slot injection path, so they read the dictionary
  // through the module-level translate instead of an injected `t` seat.
  attachLocale(ctx.locale)
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), "cocode-workbench: dictionaries")
  ctx.inject(["shortcuts"], (shortcutCtx: ClientContext) => {
    const shortcuts = shortcutCtx.get("shortcuts")
    if (shortcuts === undefined) return
    shortcutCtx.effect(() => bindFileShortcutRegistry(shortcuts), "cocode-workbench: file shortcut menu hints")
    const translate = ctx.locale.bind(LOCALE_NS)
    for (const command of fileShortcutCommands((key) => translate(key as WorkbenchKey))) {
      ctx.effect(() => shortcuts.register(command), `cocode-workbench: ${command.id}`)
    }
  })
  const controller = new WorkbenchController(layout, window.localStorage)
  const disposeService = ctx.reflect.provide("workbench", controller)
  for (const descriptor of builtInPanels()) {
    ctx.effect(() => controller.registerPanel(descriptor), `cocode-workbench: ${descriptor.id}`)
  }
  const slots = ctx.slots as unknown as {
    inject(name: string, factory: () => unknown): unknown
    register(options: unknown, component: unknown): () => void
  }
  slots.inject("workbench.right", () => slots.register({
    name: "workbench.right",
    inject: (sessionId?: string) => ({ controller, sessionId, sessions, addFileToChat: (id: string, path: string) => addFileToChat(ctx, id, path) }),
  }, DockSurface))
  slots.inject("workbench.bottom", () => slots.register({
    name: "workbench.bottom",
    inject: (sessionId?: string) => ({ controller, sessionId, sessions }),
  }, DockSurface))
  slots.inject("shell.overlay", () => slots.register({
    name: "shell.overlay",
    id: "cocode-workbench-launcher",
    order: 10,
    inject: () => ({ controller }),
  }, Launcher))
  // Source control belongs beside the New Session workspace selector, where a
  // project-scoped action can be found before opening the right workbench.
  slots.inject("conversation.hero.agentPreset", () => slots.register({
    name: "conversation.hero.agentPreset",
    priority: -2,
  }, GitHeroAction))
  // 提交消息模型是一项全局偏好，排在通用设置的既有条目之后。
  slots.inject("settings.general.item", () => slots.register({
    name: "settings.general.item",
    id: "cocode-workbench-commit-model",
    order: 40,
    inject: () => ({}),
  }, CommitModelRow))
  slots.inject("settings.section", () => slots.register({
    name: "settings.section",
    id: "cocode-workbench-command-line",
    order: 850,
    label: () => t("commandLine.title"),
  }, CommandLineSection))
  slots.inject("settings.section", () => slots.register({
    name: "settings.section",
    id: "cocode-workbench-diagnostics",
    order: 900,
    label: () => t("diagnostics.title"),
  }, DiagnosticsSection))
  slots.inject("settings.section", () => slots.register({
    name: "settings.section",
    id: "cocode-workbench-version",
    order: 1000,
    label: () => t("version.title"),
  }, VersionSection))
  ctx.effect(() => () => { void disposeService() }, "cocode-workbench: dispose service")
}
