import { equal, test } from '@yaks/testing'
import { serialized, sources } from './cli-assets.ts'

test('sandbox CLI workspace keeps runtime source and every member config', () => {
  equal(
    sources([
      'deno.json',
      'deno.lock',
      'workers/yak/deno.json',
      'apps/other/deno.json',
      'packages/cli/yak.ts',
      'packages/cli/yak_test.ts',
      'packages/task/views.tsx',
      'packages/task/vocab.json',
      'packages/task/README.md',
      'packages/task/.env',
      'packages/task/.env.json',
      'packages/task/.dev.vars.json',
      'packages/task/fixtures/source.ts',
      'packages/task/node_modules/library/index.js',
      'packages/task/assets.gen.ts',
      'packages/task/conform.ts',
      'workers/yak/secrets.ts',
    ], ['./workers/yak', './apps/other', './packages/cli']),
    [
      'apps/other/deno.json',
      'deno.json',
      'deno.lock',
      'packages/cli/yak.ts',
      'packages/task/views.tsx',
      'packages/task/vocab.json',
      'workers/yak/deno.json',
    ],
  )
})

test('sandbox CLI workspace identity follows content independent of file order', () => {
  let first = serialized({ 'packages/cli/yak.ts': 'one', 'deno.json': '{}' })
  equal(first, serialized({ 'deno.json': '{}', 'packages/cli/yak.ts': 'one' }))
  equal(JSON.parse(first).files['packages/cli/yak.ts'], 'one')
  equal(
    first == serialized({ 'deno.json': '{}', 'packages/cli/yak.ts': 'two' }),
    false,
  )
})
