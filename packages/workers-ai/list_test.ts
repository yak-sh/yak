// Model metadata follows the published page, without any inference call.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { modelInfo, pagePrice } from './list.ts'

test('embedding pages price input tokens without charging for the vector output', async () => {
  let info = await modelInfo(
    '@cf/qwen/qwen3-embedding-0.6b',
    () =>
      Promise.resolve(
        new Response(`Text Embeddings • Qwen
| Unit Pricing | $0.0118 per M input tokens |`),
      ),
  )
  assertEquals(info.price, { input: 0.0118, output: 0 })
  assertEquals(
    pagePrice('Text Generation • Vendor\n$0.01 per M input tokens'),
    undefined,
  )
  assertEquals(
    pagePrice('Text Embeddings • Vendor\nNo published price'),
    undefined,
  )
})

for (let name of ['elevenlabs/music-v2', 'minimax/music-2.6']) {
  test(`${name} metadata falls back to its full provider path`, async () => {
    let urls: string[] = []
    let info = await modelInfo(name, (url) => {
      urls.push(String(url))
      return Promise.resolve(
        urls.length == 1
          ? new Response('Not found', { status: 404 })
          : new Response('Music Generation\nPricing | Per track $0.15'),
      )
    })
    assertEquals(urls, [
      `https://developers.cloudflare.com/workers-ai/models/${
        name.split('/').at(-1)
      }/index.md`,
      `https://developers.cloudflare.com/ai/models/${name}/index.md`,
    ])
    assertEquals(info, { name })
  })
}

test('native model pages stay first and failed metadata never confirms a model', async () => {
  let urls: string[] = []
  assertEquals(
    await modelInfo('@cf/zai-org/glm-5.3-flash', (url) => {
      urls.push(String(url))
      return Promise.resolve(new Response('Context Window | 100,000 tokens'))
    }),
    { name: '@cf/zai-org/glm-5.3-flash', context: 100000 },
  )
  assertEquals(urls.length, 1)
  await assertRejects(
    () =>
      modelInfo(
        'vendor/missing',
        () => Promise.resolve(new Response('Missing', { status: 404 })),
      ),
    Error,
    '404',
  )
})

let pricedPage = (input: number) =>
  `$${input} per M input tokens, $2 per M output tokens`

test('model metadata shares concurrent reads, expires and keeps fetch bindings separate', async () => {
  let time = clock(), reads = 0
  let fetcher: typeof fetch = () =>
    Promise.resolve(new Response(pricedPage(++reads)))
  let read = () => modelInfo('vendor/model', fetcher, time)
  let infos = await Promise.all([read(), read()])
  assertEquals(infos.map((info) => info.price?.input), [1, 1])
  assertEquals((await read()).price?.input, 1)
  await time.advance(3_600_000)
  assertEquals((await read()).price?.input, 2)
  assertEquals(reads, 2)
  let other: typeof fetch = () => Promise.resolve(new Response(pricedPage(9)))
  assertEquals((await modelInfo('vendor/model', other, time)).price?.input, 9)
})

test('a failed metadata fetch is retried and an unpriced page can acquire a price', async () => {
  let time = clock(), reads = 0
  let fetcher: typeof fetch = () => {
    reads++
    return reads == 1
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(new Response(reads == 2 ? 'No price' : pricedPage(3)))
  }
  let read = () => modelInfo('vendor/model', fetcher, time)
  await assertRejects(read, Error, 'offline')
  assertEquals((await read()).price, undefined)
  assertEquals((await read()).price, undefined)
  assertEquals(reads, 2)
  await time.advance(3_600_000)
  assertEquals((await read()).price?.input, 3)
})
