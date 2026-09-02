import { SettingsConflictError } from "@deepseek-ai/dsh-settings"
import { describe, expect, it } from "vitest"
import type {
  ShortcutsHttpRequest,
  ShortcutsHttpResponse,
  ShortcutsWebRoute,
} from "../src/context-types.ts"
import { apply } from "../src/index.ts"
import type { ShortcutSettings } from "../src/settings.ts"

type FakeSettings = ReturnType<typeof createFakeSettings>

function createFakeSettings() {
  const namespaces = new Map<string, {
    schema: (input: unknown) => ShortcutSettings
    user: Record<string, unknown> | undefined
    revision: number
  }>()
  return {
    writable: true,
    namespaces,
    register(namespace: string, schema: unknown) {
      namespaces.set(namespace, {
        schema: schema as (input: unknown) => ShortcutSettings,
        user: undefined,
        revision: 0,
      })
      return {
        get: () => namespaces.get(namespace)!.schema(namespaces.get(namespace)!.user),
        watch: () => () => {},
        update: async () => {},
        replace: async () => {},
      }
    },
    describe() {
      return [...namespaces.entries()].map(([namespace, entry]) => ({
        ns: namespace,
        value: entry.schema(entry.user),
        user: entry.user,
        revision: entry.revision,
      }))
    },
    async update(namespace: string, patch: object, expectedRevision?: number) {
      const entry = namespaces.get(namespace)
      if (entry === undefined) throw new Error("namespace is not registered")
      if (expectedRevision !== undefined && expectedRevision !== entry.revision) {
        throw new SettingsConflictError(
          namespace as never,
          expectedRevision,
          entry.revision,
        )
      }
      const next = { ...entry.user, ...patch }
      entry.schema(next)
      entry.user = next
      entry.revision += 1
    },
  }
}

function mount(settings: FakeSettings = createFakeSettings()): {
  readonly route: ShortcutsWebRoute
  readonly settings: FakeSettings
} {
  const routes: ShortcutsWebRoute[] = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register(route: ShortcutsWebRoute) {
        routes.push(route)
        return () => {}
      },
    },
    effect(callback: () => void | (() => void)) {
      callback()
    },
    inject(
      dependencies: readonly string[],
      callback: (context: { settings: FakeSettings }) => void | (() => void),
    ) {
      if (dependencies.includes("settings")) callback({ settings })
      return () => {}
    },
  }
  apply(ctx as never)
  return {
    route: routes.find(candidate => candidate.path === "/cocode/shortcuts/api")!,
    settings,
  }
}

async function invoke(
  route: ShortcutsWebRoute,
  method: string,
  payload: unknown = {},
  options?: {
    readonly httpMethod?: string
    readonly headers?: Record<string, string>
    readonly rawBody?: string
  },
): Promise<{
  readonly status: number
  readonly body: {
    readonly ok: boolean
    readonly value?: unknown
    readonly error?: { readonly code?: string; readonly message?: string }
  }
}> {
  const body = Buffer.from(options?.rawBody ?? JSON.stringify(payload))
  const request = {
    method: options?.httpMethod ?? "POST",
    url: "/cocode/shortcuts/api/" + method,
    headers: options?.headers ?? { host: "127.0.0.1:3080" },
    [Symbol.asyncIterator]: async function* () {
      yield body
    },
  } as ShortcutsHttpRequest
  const output = { status: 200, body: "" }
  const response = {
    writeHead(status: number) {
      output.status = status
    },
    end(chunk?: string | Uint8Array) {
      output.body += String(chunk ?? "")
    },
  } as ShortcutsHttpResponse
  await route.handler(request, response)
  return {
    status: output.status,
    body: JSON.parse(output.body) as {
      ok: boolean
      value?: unknown
      error?: { code?: string; message?: string }
    },
  }
}

describe("cocode shortcuts settings route", () => {
  it("registers and reads only the shortcuts namespace", async () => {
    const { route, settings } = mount()
    expect([...settings.namespaces.keys()]).toEqual(["cocode-shortcuts"])

    const result = await invoke(route, "settings.get")
    expect(result.status).toBe(200)
    expect(result.body.value).toEqual({
      value: { version: 1, bindings: {} },
      revision: 0,
      writable: true,
    })
  })

  it("writes bindings with revision fencing and reloadable values", async () => {
    const { route } = mount()
    const written = await invoke(route, "settings.update", {
      patch: {
        bindings: {
          "cocode.sidebar.toggle": {
            combo: { key: "k", primary: true, shift: true },
          },
        },
      },
      expectedRevision: 0,
    })
    expect(written.status).toBe(200)
    expect(written.body.value).toMatchObject({
      value: {
        bindings: {
          "cocode.sidebar.toggle": {
            combo: { key: "k", primary: true, shift: true },
          },
        },
      },
      revision: 1,
    })

    const stale = await invoke(route, "settings.update", {
      patch: { bindings: {} },
      expectedRevision: 0,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error?.code).toBe("settings-conflict")
  })

  it("enforces trust, POST-only access, valid JSON, and the fixed method list", async () => {
    const { route } = mount()

    expect((await invoke(route, "settings.get", {}, {
      headers: { host: "evil.example" },
    })).status).toBe(403)
    expect((await invoke(route, "settings.get", {}, {
      httpMethod: "GET",
    })).status).toBe(405)
    expect((await invoke(route, "settings.get", {}, {
      rawBody: "{",
    })).body.error?.code).toBe("bad-request")
    expect((await invoke(route, "settings.delete")).status).toBe(404)
  })

  it("rejects invalid command ids and attempts to address another namespace", async () => {
    const { route } = mount()
    const invalidId = await invoke(route, "settings.update", {
      patch: {
        bindings: {
          "bad command id": { disabled: true },
        },
      },
    })
    expect(invalidId.status).toBe(400)
    expect(invalidId.body.error?.message).toMatch(/commandId/)

    const foreignNamespace = await invoke(route, "settings.update", {
      ns: "ui-theme",
      patch: { bindings: {} },
    })
    expect(foreignNamespace.status).toBe(400)
    expect(foreignNamespace.body.error?.message).toMatch(/unknown request field/)
  })
})
