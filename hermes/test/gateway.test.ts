import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Drive the same Python process manager Hermes uses. This also tests cleanup:
// a Node-only child harness can mask leaked keep-alive/orphaned gateways.
test('single PAT supports streaming, tool calls, discovery and isolation', () => {
  const script = fileURLToPath(new URL('gateway_e2e.py', import.meta.url))
  const result = spawnSync('python3', [script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Hermes gateway E2E: OK/)
})
