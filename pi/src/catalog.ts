import type { Model } from '@earendil-works/pi-ai'
import {
  QODER_FALLBACK_MODELS,
  fallbackModelInfo,
  parseUpstreamModel,
  withoutAbstractModels,
  withoutForeignRegionModels,
  withoutRouters,
  type QoderModelInfo,
} from '../../core/catalog.ts'
import type { QoderRegion, QoderUpstreamModel } from '../../core/upstream.ts'

const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export function visibleCatalog(models: readonly QoderModelInfo[], region: QoderRegion): QoderModelInfo[] {
  return withoutForeignRegionModels(withoutAbstractModels(withoutRouters(models)), region)
}

export function fallbackCatalog(region: QoderRegion): QoderModelInfo[] {
  return visibleCatalog(QODER_FALLBACK_MODELS.map(fallbackModelInfo), region)
}

export function remoteCatalog(models: readonly QoderUpstreamModel[], region: QoderRegion): QoderModelInfo[] {
  return visibleCatalog(models.filter(model => model.enable).map(parseUpstreamModel), region)
}

export function toPiModel(info: QoderModelInfo, provider: string): Model<'openai-completions'> {
  const supported = new Set(info.thinkingEfforts ?? [])
  const levels = THINKING_LEVELS.filter(level => supported.has(level))
  const thinkingLevelMap = levels.length === 0 ? undefined : Object.fromEntries([
    ...THINKING_LEVELS.map(level => [level, supported.has(level) ? level : null]),
    ['off', info.canDisableThinking ? 'off' : null],
  ])
  return {
    id: info.key,
    name: `${info.displayName} · x${info.priceFactor.toFixed(2)}`,
    api: 'openai-completions',
    provider,
    // ModelAuth.baseUrl replaces this placeholder before every request. It is a
    // parseable loopback URL so direct Provider inspection remains well formed.
    baseUrl: 'http://127.0.0.1',
    input: info.supportsImages ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info.contextWindow,
    maxTokens: info.maxOutputTokens,
    reasoning: thinkingLevelMap !== undefined,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    compat: {
      supportsReasoningEffort: thinkingLevelMap !== undefined,
      supportsDeveloperRole: false,
      supportsMidConvoSystemMessages: false,
      sendSessionAffinityHeaders: true,
      sessionAffinityFormat: 'openai',
    },
  }
}
