import test from 'node:test'
import assert from 'node:assert/strict'
import { stream } from '@earendil-works/pi-ai/api/openai-responses'

const model = {
  api: 'openai-responses',
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  provider: 'cocode-nut',
  baseUrl: 'https://cocode.agency/v1',
  reasoning: true,
  input: ['text'],
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  thinkingLevelMap: { high: 'high', max: 'max' },
}

function capturePayload(options) {
  let payload
  const events = stream(model, { messages: [{ role: 'user', content: 'hi' }] }, {
    apiKey: 'test-key',
    ...options,
    onPayload: (next) => {
      payload = next
      throw new Error('stop after payload capture')
    },
  })
  return events.result().then(() => payload)
}

test('Cocode Nut reasoning effort does not imply unsupported Responses summary', async () => {
  for (const effort of ['high', 'max']) {
    const payload = await capturePayload({ reasoningEffort: effort })
    assert.deepEqual(payload.reasoning, {
      effort,
    })
  }
})

test('explicit Responses reasoning summary remains available', async () => {
  const payload = await capturePayload({
    reasoningEffort: 'high',
    reasoningSummary: 'detailed',
  })
  assert.deepEqual(payload.reasoning, {
    effort: 'high',
    summary: 'detailed',
  })
})
