export * from './protocol.js'
export * from './observability.js'
export { HostLogger, type HostLoggerOptions } from './logging.js'
export * from './client.js'
export {
  createLeaseRecord,
  HOST_ACQUIRE_ABANDONED_MESSAGE,
  isLeaseActive,
  type LeaseRecord,
} from './lifecycle.js'
export { writeLineFrame, type LineFrameOutput } from './ipc.js'
export {
  addRuntimePluginDependencies,
  createRuntimePatch,
  mergeHostRuntimeEnv,
  prepareRuntimeSlot,
  ensureCocodeProfile,
  type RuntimePluginEntry,
  type RuntimeSlot,
} from './runtime.js'
export { connectJsonRpc, type JsonRpcPeer } from './socket-jsonrpc-client.js'
export {
  DOCUMENT_VERSION,
  CredentialsError,
  detectCredentialsLayout,
  parseCredentialsDocument,
  renderCredentialsUpdate,
  loadCredentials,
  writeCredentialRef,
  moveCredentialRef,
  refreshCredentials,
  readCredentials,
  patchCredential,
  withCredentialsLock,
  type CredentialRefMap,
  type CredentialRecord,
  type CredentialRecordMap,
  type CredentialsDocument,
  type CredentialsErrorCode,
  type CredentialsLayout,
} from './credentials-local.js'
export {
  createExternalDshReadSource,
  ExternalDshReader,
  type ExternalDshReadSource,
  type ExternalDshReadSourceOptions,
  type ExternalDshSourceStatus,
  type ExternalDshChange,
  type ExternalDshConflictStatus,
  type ExternalSessionSummary,
  type ExternalSessionHistory,
  type ExternalSessionEvent,
  type ExternalWorkspace,
  type ExternalWorkspaceSnapshot,
  type ExternalProjectionSnapshot,
  type ExternalAttachmentRef,
  type VerifiedAttachment,
} from './external-dsh-reader.js'
