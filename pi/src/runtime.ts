import { QoderUpstreamClient, type QoderRegion } from '../../core/upstream.ts'
import { createQoderShim, type QoderShim } from '../../core/shim.ts'
import { fallbackCatalog, remoteCatalog } from './catalog.ts'

export const REGIONS = {
  qoder: { region: 'cn', name: 'Qoder CN', env: 'QODERCN_PERSONAL_ACCESS_TOKEN' },
  'qoder-global': { region: 'global', name: 'Qoder Global', env: 'QODER_PERSONAL_ACCESS_TOKEN' },
} as const
export type ProviderId = keyof typeof REGIONS

export function patFromCredential(credential: { key?: string; env?: Record<string, unknown> } | undefined, envName: string): string | undefined {
  const embedded = credential?.env?.[envName]
  const pat = credential?.key ?? (typeof embedded === 'string' ? embedded : undefined)
  return pat?.trim() || undefined
}

/** Owns no sockets until a provider actually needs authentication. */
export class QoderRuntime {
  readonly upstream: QoderUpstreamClient
  readonly catalog = new Map<string, QoderRegion>()
  private shimPromise: Promise<QoderShim> | undefined
  private pat: string | undefined
  private closing = false

  readonly id: ProviderId

  constructor(id: ProviderId) {
    this.id = id
    this.upstream = new QoderUpstreamClient(REGIONS[id].region)
    for (const info of fallbackCatalog(REGIONS[id].region)) this.catalog.set(info.key, REGIONS[id].region)
  }

  setPat(pat: string): void {
    if (this.pat === pat) return
    // A changed PAT must never inherit the previous account's jobToken/session.
    const oldShim = this.shimPromise
    this.shimPromise = undefined
    this.pat = pat
    void oldShim?.then(shim => shim.close()).catch(() => {})
  }

  async resolve(pat: string): Promise<{ apiKey: string; baseUrl: string }> {
    if (this.closing) throw new Error('Qoder extension is shutting down')
    this.setPat(pat)
    this.shimPromise ??= this.start()
    const shim = await this.shimPromise
    return { apiKey: shim.secret, baseUrl: `${shim.baseUrl}/v1` }
  }

  private async start(): Promise<QoderShim> {
    const shim = createQoderShim({
      upstream: this.upstream,
      credential: () => this.pat,
      supportsImagesOf: key => this.supportsImages(key),
    })
    try {
      await shim.ready
      return shim
    } catch (error) {
      if (this.shimPromise) this.shimPromise = undefined
      await shim.close().catch(() => {})
      throw error
    }
  }

  supportsImages(key: string): boolean {
    return this.lastModels?.find(model => model.key === key)?.supportsImages ??
      fallbackCatalog(REGIONS[this.id].region).find(model => model.key === key)?.supportsImages ?? false
  }

  private lastModels: ReturnType<typeof fallbackCatalog> | undefined

  async fetchModels(pat: string, signal: AbortSignal): Promise<ReturnType<typeof fallbackCatalog>> {
    const models = remoteCatalog(await this.upstream.fetchModels(pat, signal), REGIONS[this.id].region)
    if (models.length === 0) throw new Error('Qoder returned no enabled models')
    this.lastModels = models
    this.catalog.clear()
    for (const model of models) this.catalog.set(model.key, REGIONS[this.id].region)
    return models
  }

  async validate(pat: string, signal: AbortSignal): Promise<void> {
    await this.upstream.exchangeJobToken(pat)
    signal.throwIfAborted()
  }

  async close(): Promise<void> {
    this.closing = true
    const pending = this.shimPromise
    this.shimPromise = undefined
    await pending?.then(shim => shim.close()).catch(() => {})
  }
}
