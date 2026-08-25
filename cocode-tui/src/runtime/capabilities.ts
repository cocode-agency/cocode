/**
 * P0 wire capabilities. Flip a bit only when connection grows a method.
 */

export type TuiCapabilities = {
  cancel: boolean
  open: boolean
  fork: boolean
  approval: boolean
  permissionMode: boolean
  planMode: boolean
  promptMode: boolean
  queueMode: boolean
  modelList: boolean
  imageAttachments: boolean
  rewind: boolean
  sessionList: 'none' | 'jsonl' | 'rpc'
  skills: boolean
  commands: boolean
  plugins: boolean
  pluginsMutate: boolean
  sessionRename?: boolean
}

export const P0_CAPABILITIES: TuiCapabilities = {
  cancel: true,
  open: true,
  fork: true,
  approval: false,
  permissionMode: false,
  planMode: false,
  promptMode: false,
  queueMode: false,
  modelList: false,
  imageAttachments: false,
  rewind: true,
  sessionList: 'none',
  skills: false,
  commands: false,
  plugins: false,
  pluginsMutate: false,
}
