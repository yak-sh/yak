// Model metadata follows the published page, without any inference call.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { modelInfo } from './list.ts'

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
