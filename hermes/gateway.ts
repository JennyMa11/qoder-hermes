/**
 * Hermes-facing Qoder CN gateway.
 *
 * One process owns exactly one PAT. It arrives on stdin, never argv or the
 * environment, and stdout is reserved for the one-line readiness descriptor.
 * Hermes receives only the shim's loopback URL and its random bearer secret.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createQoderShim } from '../core/shim.ts'
import {
  QoderUpstreamClient,
  type QoderUpstreamOptions,
} from '../core/upstream.ts'
import {
  QODER_FALLBACK_MODELS,
  fallbackModelInfo,
  parseUpstreamModel,
  withoutAbstractModels,
  withoutForeignRegionModels,
  withoutRouters,
  type QoderModelInfo,
} from '../core/catalog.ts'

function usable(models: readonly QoderModelInfo[]): QoderModelInfo[] {
  return withoutForeignRegionModels(
    withoutAbstractModels(withoutRouters(models), 'cn'),
    'cn',
  )
}

async function main(): Promise<void> {
  const pat = (await new Promise<string>((resolve, reject) => {
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', resolve)
    // Keep a data listener after the credential line: stdin's EOF is also the
    // parent's lifetime signal. resume() alone can still select paused mode.
    process.stdin.on('data', () => {})
    process.stdin.once('error', reject)
  })).trim()
  if (!pat) throw new Error('Qoder CN requires a PAT on stdin')

  const upstreamOptions: QoderUpstreamOptions = {}
  if (process.env.QODER_CN_TEST_UPSTREAM_URL) {
    const endpoint = new URL(process.env.QODER_CN_TEST_UPSTREAM_URL)
    upstreamOptions.fetch = async (input, init) => {
      const original = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      original.protocol = endpoint.protocol
      original.host = endpoint.host
      return fetch(original, init)
    }
  }
  const upstream = new QoderUpstreamClient('cn', upstreamOptions)
  const models = usable(QODER_FALLBACK_MODELS.map(fallbackModelInfo))
  const byKey = new Map(models.map(model => [model.key, model]))

  const shim = await createQoderShim({
    upstream,
    credential: () => pat,
    modelKeyOf: id => byKey.get(id)?.key,
    supportsImagesOf: id => byKey.get(id)?.supportsImages ?? false,
    listModelIds: () => [...byKey.keys()],
  })

  // Keep catalog serving separate from chat: a failed refresh must not tear down
  // an in-flight conversation or make the last known models disappear.
  const catalog = createServer((req, res) => {
    const finish = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'GET' || !['/models', '/v1/models'].includes(req.url ?? '')) {
      finish(404, { error: { message: 'not found' } })
      return
    }
    void (async () => {
      const remote = await upstream.fetchModels(pat)
      for (const raw of remote) {
        const info = parseUpstreamModel(raw)
        if (usable([info]).length) byKey.set(info.key, info)
      }
      finish(200, {
        object: 'list',
        data: [...byKey.values()].map(model => ({
          id: model.key,
          object: 'model',
          owned_by: 'qoder-cn',
          context_window: model.contextWindow,
          max_tokens: model.maxOutputTokens,
        })),
      })
    })().catch(() => finish(200, {
      object: 'list',
      data: [...byKey.values()].map(model => ({ id: model.key, object: 'model', owned_by: 'qoder-cn' })),
    }))
  })
  catalog.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    catalog.once('listening', resolve)
    catalog.once('error', reject)
  })

  process.stdout.write(JSON.stringify({
    base_url: `${shim.baseUrl}/v1`,
    api_key: shim.secret,
    models_url: `http://127.0.0.1:${(catalog.address() as AddressInfo).port}/v1/models`,
  }) + '\n')

  let closing = false
  const close = async (): Promise<void> => {
    if (closing) return
    closing = true
    // closeAllConnections also releases undici's keep-alive sockets. Without
    // them server.close() can wait forever and leave a PAT-bearing orphan.
    catalog.closeAllConnections()
    await Promise.all([
      shim.close(),
      new Promise<void>(resolve => catalog.close(() => resolve())),
    ])
  }
  process.once('SIGTERM', () => { void close().finally(() => process.exit(0)) })
  process.once('SIGINT', () => { void close().finally(() => process.exit(0)) })
  process.stdin.once('end', () => { void close().finally(() => process.exit(0)) })
}

void main().catch(error => {
  process.stderr.write(`Qoder CN gateway failed: ${String((error as Error)?.message ?? error)}\n`)
  process.exit(1)
})
