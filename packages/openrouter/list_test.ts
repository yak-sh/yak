import { equal, test } from '@yaks/testing'
import { listing } from './list.ts'

test('the catalogue keeps each provider output limit independently of context', async () => {
  let models = await listing(() =>
    Promise.resolve(Response.json({
      data: [
        {
          id: 'large',
          context_length: 1_000_000,
          top_provider: { max_completion_tokens: 128_000 },
        },
        {
          id: 'small',
          context_length: 32_000,
          top_provider: { max_completion_tokens: 2048 },
        },
        { id: 'unknown', top_provider: { max_completion_tokens: null } },
      ],
    }))
  )
  equal(models, [
    { name: 'large', context: 1_000_000, output: 128_000 },
    { name: 'small', context: 32_000, output: 2048 },
    { name: 'unknown' },
  ])
})
