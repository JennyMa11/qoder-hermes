import assert from 'node:assert/strict'
import test from 'node:test'
import { fallbackCatalog, remoteCatalog, toPiModel } from '../src/catalog.ts'
import { patFromCredential, QoderRuntime } from '../src/runtime.ts'

const rawModel = {
  key: 'model-demo', display_name: 'Demo Model', enable: true,
  is_default: true, is_vl: true, is_reasoning: true, is_free: false,
  price_factor: 0.5, max_input_tokens: 128000, max_output_tokens: 16384,
  thinking_config: { enabled: { efforts: { high: { is_default: true } } }, disabled: {} },
  context_config: undefined, raw: {},
}

test('fallback respects region and excludes abstract routes', () => {
  const cn = fallbackCatalog('cn')
  const global = fallbackCatalog('global')
  assert(!cn.some(model => model.key === 'cmodel'))
  assert(global.some(model => model.key === 'cmodel'))
  assert(!global.some(model => ['auto', 'fast', 'ultimate', 'efficient'].includes(model.key)))
})

test('dynamic catalog maps only enabled models and Qoder thinking levels', () => {
  const [model] = remoteCatalog([rawModel], 'cn')
  assert(model)
  const piModel = toPiModel(model, 'qoder')
  assert.equal(piModel.id, 'model-demo')
  assert.equal(piModel.api, 'openai-completions')
  assert.equal(piModel.contextWindow, 128000)
  assert.equal(piModel.thinkingLevelMap?.high, 'high')
  assert.equal(piModel.thinkingLevelMap?.off, 'off')
  assert.equal(piModel.thinkingLevelMap?.low, null)
  assert.equal(piModel.compat?.supportsDeveloperRole, false)
  assert.equal(piModel.compat?.sessionAffinityFormat, 'openai')
  assert.deepEqual(remoteCatalog([{ ...rawModel, enable: false }], 'cn'), [])
})

test('credentials are trimmed and never confused with the other region', () => {
  assert.equal(patFromCredential({ key: '  fake-pat  ' }, 'QODERCN_PERSONAL_ACCESS_TOKEN'), 'fake-pat')
  assert.equal(patFromCredential({ env: { QODERCN_PERSONAL_ACCESS_TOKEN: 'fake-pat' } }, 'QODERCN_PERSONAL_ACCESS_TOKEN'), 'fake-pat')
  assert.equal(patFromCredential({ env: { QODER_PERSONAL_ACCESS_TOKEN: 'other-region' } }, 'QODERCN_PERSONAL_ACCESS_TOKEN'), undefined)
})

test('runtime does not open a socket until authentication is resolved', async () => {
  const runtime = new QoderRuntime('qoder')
  const auth = await runtime.resolve('fake-pat')
  assert.match(auth.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  assert(auth.apiKey.length >= 32)
  const health = await fetch(auth.baseUrl.replace(/\/v1$/, '/healthz'), { headers: { authorization: `Bearer ${auth.apiKey}` } })
  assert.equal(health.status, 200)
  const rejected = await fetch(auth.baseUrl.replace(/\/v1$/, '/v1/models'))
  assert.equal(rejected.status, 401)
  await runtime.close()
  await assert.rejects(fetch(auth.baseUrl.replace(/\/v1$/, '/healthz')))
})
