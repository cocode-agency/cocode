import type { DshBootBatchDto, DshBootEntryDto } from "../../../contracts/ipc/dsh-runtime.contract"

export const DSH_CLIENT_HMR_ID = "@deepseek-ai/dsh-client-hmr"

/** DSH browser entries that expose implementation diagnostics to the UI. */
export const DSH_DEV_ONLY_ENTRY_IDS: ReadonlySet<string> = new Set([
	DSH_CLIENT_HMR_ID,
	"@deepseek-ai/dsh-client-ui-trajectory",
	"@deepseek-ai/dsh-session-log-export",
])

/**
 * The HMR client subscribes to the dev-only `/plugins/events` SSE route. A
 * packaged Renderer loads from `file://`, so that relative route would become
 * `file:///plugins/events`; the packaged shell has no need for HMR anyway.
 */
export function selectDshBootEntries(
	entries: readonly DshBootEntryDto[],
	production: boolean,
): readonly DshBootEntryDto[] {
	if (!production) return entries
	return entries.filter((entry) => !DSH_DEV_ONLY_ENTRY_IDS.has(entry.id))
}

/** Keep initial-load batches consistent with the entries selected for this shell. */
export function selectDshBootBatches(
	batches: readonly DshBootBatchDto[],
	entries: readonly DshBootEntryDto[],
): readonly DshBootBatchDto[] {
	const entryIds = new Set(entries.map((entry) => entry.id))
	return batches
		.map((batch) => ({
			...batch,
			entries: batch.entries.filter((entry) => entryIds.has(entry)),
		}))
		.filter((batch) => batch.entries.length > 0)
}
