import assert from 'node:assert/strict'
import test from 'node:test'
import type { Provider } from '@earendil-works/pi-ai'
import extension from '../index.ts'

test('extension registers native providers, commands and lifecycle', async () => {
  const providers: Provider[] = []
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>()
  const events = new Map<string, () => Promise<void>>()
  extension({
    registerProvider: (provider: Provider) => providers.push(provider),
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
    on: (name: string, handler: () => Promise<void>) => events.set(name, handler),
  } as never)
  assert.deepEqual(providers.map(provider => provider.id), ['qoder', 'qoder-global'])
  assert(providers.every(provider => provider.refreshModels && provider.auth.apiKey?.login && provider.auth.apiKey.resolve))
  assert(providers.every(provider => provider.getModels().length > 0), 'offline fallback models must be available immediately after login')
  assert.deepEqual([...commands.keys()], ['qoder-status', 'qoder-refresh'])
  const shutdown = events.get('session_shutdown')
  assert(shutdown)
  await shutdown()
})

test('auth resolve uses stored PAT and supplies per-request shim auth', async () => {
  let provider: Provider | undefined
  let shutdown: (() => Promise<void>) | undefined
  extension({
    registerProvider: (value: Provider) => { if (value.id === 'qoder') provider = value },
    registerCommand: () => {},
    on: (name: string, handler: () => Promise<void>) => { if (name === 'session_shutdown') shutdown = handler },
  } as never)
  try {
    const result = await provider?.auth.apiKey?.resolve({
      ctx: { env: async () => undefined, fileExists: async () => false },
      credential: { type: 'api_key', key: 'fake-pat' },
      signal: new AbortController().signal,
    })
    assert(result)
    assert.equal(result.source, 'Qoder CN PAT (stored)')
    assert.match(result.auth.baseUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  } finally {
    await shutdown?.()
  }
})
