// Compatibility entry point for cocode packages that still live under
// packages/cocode/* while the DSH client packages are under packages/client/*.
// Keep the implementation in client/tsdown.client.ts so both package layouts
// use the same build-face and module-table rules.
export {
	INLINE_SAFE,
	clientBundle,
	clientLibrary,
	clientOnly,
	isStaticLinkedConfig,
	requestedExternals,
	staticLinked,
} from './client/tsdown.client.ts'
