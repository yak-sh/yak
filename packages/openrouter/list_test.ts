import { equal, test } from '@yaks/testing'
import { listing } from './list.ts'
import { modelReads } from '@yaks/model'
import { responses } from './mod.ts'
import { messages } from './prompt.ts'

test('native file capabilities follow the selected model catalogue row', async () => {
  let model = responses({
    key: () => 'key',
    fetch: () =>
      Promise.resolve(Response.json({
        data: [
          {
            id: 'vision',
            architecture: { input_modalities: ['text', 'image', 'file'] },
          },
          { id: 'text', architecture: { input_modalities: ['text'] } },
        ],
      })),
  })
  equal(Object.keys(await modelReads(model, 'vision')).sort(), [
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
  ])
  equal(await modelReads(model, 'text'), {})
  equal(await model.list?.(), [{ name: 'vision' }, { name: 'text' }])
  equal(await model.info?.('vision'), { name: 'vision' })
  equal(
    messages({
      model: 'vision',
      tools: [],
      items: [{
        kind: 'document',
        bytes: new Uint8Array([1, 2]),
        mediaType: 'application/pdf',
        filename: 'report.pdf',
        label: 'Attached report',
      }],
    }),
    [{
      role: 'user',
      content: [
        { type: 'text', text: 'Attached report' },
        {
          type: 'file',
          file: {
            filename: 'report.pdf',
            file_data: 'data:application/pdf;base64,AQI=',
          },
        },
      ],
    }],
  )
})

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
