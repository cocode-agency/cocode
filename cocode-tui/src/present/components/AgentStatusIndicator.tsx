import { Text } from 'ink'
import type { TuiSnapshot } from '../../runtime/app-contracts.ts'
import { isAppleTerminalEnvironment } from '../../runtime/platform.ts'
import { useSpinnerFrame } from '../use-spinner.ts'
import { agentColor, agentFrames } from './agent-status.ts'

export function AgentStatusIndicator(props: { agent: TuiSnapshot['agent'] }) {
  const frames = agentFrames(props.agent)
  // Apple Terminal repaints the whole row per frame, which reads as flicker.
  const frame = useSpinnerFrame(frames, !isAppleTerminalEnvironment())
  return <Text color={agentColor(props.agent)}>{frame}</Text>
}
