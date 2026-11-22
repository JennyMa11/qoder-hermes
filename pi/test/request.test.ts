import assert from 'node:assert/strict'
import test from 'node:test'
import { createModels, createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { createQoderShim } from '../../core/shim.ts'

/** No network: the same shim and Pi stream implementation, with a fake upstream. */
function upstreamWith(chatStream: (messages: unknown[], options: any) => Promise<unknown>) {
  return { chatStream: async (_pat: string, _key: string, messages: unknown[], options: any) => chatStream(messages, options) }
}

test('Pi OpenAI stream passes through shim and converts Qoder deltas', async () => {
  let received: any
  const shim = createQoderShim({
    upstream: upstreamWith(async (messages, options) => {
      received = { messages, options }
      await options.onDelta({ role: 'assistant', content: 'local-ok', reasoningContent: '', toolCalls: undefined, inputTokens: 0, outputTokens: 0 })
      return null
    }) as any,
    credential: () => 'fake-pat',
  })
  try {
    await shim.ready
    const models = createModels()
    const provider = createProvider({
      id: 'qoder-test', models: [], api: openAICompletionsApi(),
      auth: { apiKey: {
        name: 'fake', resolve: async () => ({ auth: { apiKey: shim.secret, baseUrl: `${shim.baseUrl}/v1` }, source: 'test' }),
      } },
    })
    models.setProvider(provider)
    const model = { id: 'fake-model', name: 'Fake', api: 'openai-completions' as const, provider: 'qoder-test', baseUrl: 'http://placeholder/v1', reasoning: false, compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: 'openai' as const }, input: ['text' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }
    const result = await models.completeSimple(model, { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }, { sessionId: 'local-session' })
    assert.equal(result.stopReason, 'stop')
    assert.equal(result.content.filter(part => part.type === 'text').map((part: any) => part.text).join(''), 'local-ok')
    assert.equal(received.options.sessionId, 'local-session')
    assert(received.messages.some((message: any) => message.content === 'hello'))
  } finally {
    await shim.close()
  }
})

test('shim forwards tool definitions and returns OpenAI tool calls', async () => {
  let received: any
  const shim = createQoderShim({
    upstream: upstreamWith(async (messages, options) => {
      received = { messages, options }
      await options.onDelta({ role: 'assistant', content: '', reasoningContent: '', inputTokens: 0, outputTokens: 0, toolCalls: [{ index: 0, id: 'call-demo', type: 'function', function: { name: 'lookup', arguments: '{"q":"demo"}' } }] })
      return null
    }) as any,
    credential: () => 'fake-pat',
  })
  try {
    await shim.ready
    const response = await fetch(`${shim.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${shim.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fake-model', stream: true, messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }] }),
    })
    const text = await response.text()
    assert.equal(response.status, 200)
    assert.match(text, /call-demo/)
    assert.match(text, /lookup/)
    assert.equal(received.options.tools[0].function.name, 'lookup')
  } finally {
    await shim.close()
  }
})
