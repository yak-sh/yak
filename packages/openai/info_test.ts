import { equal, test } from '@yaks/testing'
import { described, limits } from './info.ts'

test('published model limits support both official markdown layouts and retain unknowns', () => {
  equal(
    limits(`- Context window: 400,000 tokens
- Max input: 272,000 tokens
- Max output: 128,000 tokens`),
    { context: 400000, output: 128000 },
  )
  equal(limits('No published model limits'), {})
})

test('API-provided token limits stand and need no documentation lookup', async () => {
  equal(
    await described({ name: 'custom', context: 123, output: 45 }, () => {
      throw new Error('No public docs for a custom model')
    }),
    { name: 'custom', context: 123, output: 45 },
  )
})

test('an API context window is sufficient without optional output metadata', async () => {
  equal(
    await described({ name: 'custom', context: 123 }, () => {
      throw new Error('No public docs needed for a known API window')
    }),
    { name: 'custom', context: 123 },
  )
})

test('snapshot metadata follows its published alias without forwarding credentials', async () => {
  let paths: string[] = []
  let model = await described({ name: 'custom-2026-11-08' }, (url, init) => {
    equal(init, undefined)
    paths.push(String(url))
    return Promise.resolve(
      paths.length == 1
        ? new Response('Missing', { status: 404 })
        : new Response('- 12,345 context window\n- 567 max output tokens'),
    )
  })
  equal(model, { name: 'custom-2026-11-08', context: 12345, output: 567 })
  equal(paths, [
    'https://developers.openai.com/api/docs/models/custom-2026-11-08.md',
    'https://developers.openai.com/api/docs/models/custom.md',
  ])
})

test('a model page that fails is a failure that may pass', async () => {
  let error = await described(
    { name: 'custom' },
    () => Promise.resolve(new Response('Busy', { status: 503 })),
  ).catch((e) => e)
  equal([error.code, error.retry], ['metadata', {}])
})
