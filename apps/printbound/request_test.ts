import { equal, test } from '@yaks/testing'
import { relative } from './request.ts'

test('mount normalization preserves legacy capability query and request body', async () => {
  let input = new Request(
    'https://checks.yaks.app/preview/mcp?access_token=kept',
    {
      method: 'POST',
      body: JSON.stringify({ order: 'kept' }),
      headers: {
        'x-yak-mount': '/preview/',
        'x-yak-app': 'preview',
        'x-yak-via': 'browser',
      },
    },
  )
  let output = relative(input)
  equal(new URL(output.url).pathname, '/mcp')
  equal(new URL(output.url).searchParams.get('access_token'), 'kept')
  equal(await output.json(), { order: 'kept' })
  equal(output.headers.get('x-yak-via'), 'browser')
  equal(output.headers.get('x-yak-address'), input.url)
})

test('root-mounted custom domains retain their public route', () => {
  let output = relative(
    new Request('https://print.example/receipt?order=kept', {
      headers: { 'x-yak-mount': '/', 'x-yak-app': 'preview' },
    }),
  )
  equal(new URL(output.url).pathname, '/receipt')
})
