import { createProvider, type ApiKeyCredential } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fallbackCatalog, toPiModel } from './src/catalog.ts'
import { QoderRuntime, REGIONS, patFromCredential, type ProviderId } from './src/runtime.ts'

export default function qoderExtension(pi: ExtensionAPI): void {
  const runtimes = new Map<ProviderId, QoderRuntime>()

  for (const id of Object.keys(REGIONS) as ProviderId[]) {
    const config = REGIONS[id]
    const runtime = new QoderRuntime(id)
    runtimes.set(id, runtime)
    pi.registerProvider(createProvider({
      id,
      name: config.name,
      // Keep the login-time catalog useful offline; refreshModels replaces this
      // baseline only after Qoder returns a non-empty enabled model list.
      models: fallbackCatalog(config.region).map(info => toPiModel(info, id)),
      api: openAICompletionsApi(),
      auth: {
        apiKey: {
          name: `${config.name} Personal Access Token`,
          login: async interaction => {
            interaction.notify({ type: 'info', message: `Get a PAT from ${config.name} account settings. It is stored by Pi, not by this extension.` })
            const pat = (await interaction.prompt({ type: 'secret', message: `${config.name} PAT` })).trim()
            if (!pat) throw new Error('PAT cannot be empty')
            await runtime.validate(pat, interaction.signal)
            return { type: 'api_key', key: pat }
          },
          resolve: async ({ ctx, credential, signal }) => {
            const pat = patFromCredential(credential, config.env) ?? (await ctx.env(config.env))?.trim()
            if (!pat) return undefined
            signal.throwIfAborted()
            const auth = await runtime.resolve(pat)
            return { auth, source: credential?.key ? `${config.name} PAT (stored)` : config.env }
          },
        },
      },
      fetchModels: async ({ credential, signal }) => {
        const pat = patFromCredential(credential as ApiKeyCredential | undefined, config.env) ?? process.env[config.env]?.trim()
        if (!pat) throw new Error(`Missing ${config.env}; run /login ${id}`)
        signal.throwIfAborted()
        return (await runtime.fetchModels(pat, signal)).map(info => toPiModel(info, id))
      },
    }))
  }

  pi.registerCommand('qoder-status', {
    description: 'Show Qoder providers and configuration help',
    handler: async (_args, ctx) => {
      const statuses = await Promise.all((Object.keys(REGIONS) as ProviderId[]).map(async id => {
        const status = ctx.modelRegistry.getProviderAuthStatus(id)
        return `${REGIONS[id].name}: ${status.configured ? `configured (${status.label ?? status.source ?? 'PAT'})` : `not configured — /login ${id} or set ${REGIONS[id].env}`}`
      }))
      ctx.ui.notify(statuses.join('\n'), 'info')
    },
  })

  pi.registerCommand('qoder-refresh', {
    description: 'Refresh Qoder CN and Global model catalogs',
    handler: async (_args, ctx) => {
      const result = await ctx.modelRegistry.refresh({ providers: Object.keys(REGIONS), allowNetwork: true, force: true })
      if (result.errors.size) {
        const detail = [...result.errors].map(([id, error]) => `${id}: ${error.message}`).join('\n')
        ctx.ui.notify(`Qoder catalog refresh failed:\n${detail}`, 'error')
      } else {
        ctx.ui.notify('Qoder model catalogs refreshed.', 'info')
      }
    },
  })

  pi.on('session_shutdown', async () => {
    await Promise.all([...runtimes.values()].map(runtime => runtime.close()))
  })
}
