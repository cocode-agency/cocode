import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { writeLineFrame } from '../lib/index.js'

test('writes one newline-delimited frame to a writable connection', () => {
  const writes = []
  const output = {
    destroyed: false,
    writable: true,
    write(value) {
      writes.push(value)
      return true
    },
  }

  assert.equal(writeLineFrame(output, { id: 1, result: { ok: true } }), true)
  assert.deepEqual(writes, ['{"id":1,"result":{"ok":true}}\n'])
})

test('does not write to a destroyed connection', () => {
  assert.equal(writeLineFrame({
    destroyed: true,
    writable: false,
    write() {
      throw new Error('must not write')
    },
  }, { id: 2, result: {} }), false)
})

test('turns synchronous connection write failures into a false result', () => {
  assert.equal(writeLineFrame({
    destroyed: false,
    writable: true,
    write() {
      throw new Error('closed between checks')
    },
  }, { id: 3, error: { code: -32000, message: 'failed' } }), false)
})

test('preserves business error details in the line response payload', async () => {
  const writes = []
  const input = new EventEmitter()
  const output = {
    write(value) {
      writes.push(value)
    },
  }
  const { CompanionTransport } = await import('../lib/host-jsonrpc-plugin.js')
  const transport = new CompanionTransport(input, output)
  transport.onRequest(async () => {
    const error = new Error('missing queue item')
    error.code = 'queue-item-not-found'
    error.details = { itemId: 'q1' }
    throw error
  })
  transport.start()
  input.emit?.('data', `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'queue' })}\n`)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(JSON.parse(writes[0]), {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: -32603,
      message: 'missing queue item',
      data: { code: 'queue-item-not-found', details: { itemId: 'q1' } },
    },
  })
})
