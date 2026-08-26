import type { TuiSnapshot } from '../../runtime/app-contracts.ts'
import { glyphs } from '../glyphs.ts'
import { theme } from '../theme.ts'

/** Frame cadence belongs to the shared clock in `use-spinner.ts`, not here. */
export function agentFrames(agent: TuiSnapshot['agent']): readonly string[] {
  if (agent === 'running') return glyphs.spinner
  if (agent === 'starting') return glyphs.startingSpinner
  if (agent === 'dead') return [glyphs.deadMark]
  return [glyphs.idleMark]
}

export function agentMark(agent: TuiSnapshot['agent']): string {
  return agentFrames(agent)[0] ?? glyphs.idleMark
}

export function agentColor(agent: TuiSnapshot['agent']): string {
  if (agent === 'running') return theme.accent
  if (agent === 'dead') return theme.danger
  if (agent === 'starting') return theme.mute
  return theme.success
}
