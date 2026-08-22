export interface FileSearchRequest {
  readonly cwd: string
  readonly query: string
  readonly limit: number
  readonly searchId: string
  readonly revision: number
}

export interface FileSearchResult {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

export type FileSearchWorkerRequest =
  | { readonly type: "search"; readonly requestId: number; readonly value: FileSearchRequest }
  | { readonly type: "cancel"; readonly requestId: number }
  | { readonly type: "invalidate"; readonly cwd: string }

export type FileSearchWorkerResponse =
  | { readonly type: "result"; readonly requestId: number; readonly value: FileSearchResult }
  | { readonly type: "canceled"; readonly requestId: number }
  | { readonly type: "error"; readonly requestId: number; readonly message: string }
