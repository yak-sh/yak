import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { encode } from 'fast-png'
import { checkedImage, generation } from './generation.ts'
import { memory } from '../printbound/storefront_fixture.ts'
import manifest from './vocab.json' with { type: 'json' }

test('a page request sends ordered character and prior-page references before its scene prompt', () => {
  let { db, binding } = memory(manifest)
  let driver = generation(db, binding, { person: crypto.randomUUID() }, {
    preview: false,
    font: '',
    printer: '',
    model: 'gpt-image-2.6-sunburst',
  })
  let job = crypto.randomUUID(),
    refs = [{ blob: 'a'.repeat(64), label: 'Character sheet' }, {
      blob: 'b'.repeat(64),
      label: 'Prior page appearance only',
    }]
  let rows = driver.request(job, 'A new scene at the bridge', refs)
  assertEquals(
    rows.slice(0, 2).map((r) => [r.entry, r.attachment, r.content]),
    refs.map((
      r,
      index,
    ) => [{ session: job, seq: index + 1 }, {
      artifact: r.blob,
      audience: 'model',
    }, { body: r.label }]),
  )
  assertEquals(rows.at(-1)!.content, { body: 'A new scene at the bridge' })
  let sending = rows.at(-1)!.sending as { input: { size: string } }
  assertEquals(sending.input.size, '2400x3040')
})

let pngHeader = Uint8Array.from([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  0,
  0,
  9,
  96,
  0,
  0,
  11,
  224,
])

test('a coloring page checks the PNG dimensions without inflating its pixels', () => {
  checkedImage(pngHeader, '2400x3040')
  let tiny = encode({
    width: 8,
    height: 8,
    data: new Uint8Array(64),
    channels: 1,
  })
  assertThrows(
    () => checkedImage(tiny, '2400x3040'),
    Error,
    'different size',
  )
  assertThrows(
    () => checkedImage(new Uint8Array(24), '2400x3040'),
    Error,
    'PNG',
  )
})

let artwork = encode({
  width: 2400,
  height: 3040,
  data: new Uint8Array(2400 * 3040),
  channels: 1,
})

test('a completed page streams the original bytes to protected artwork', async () => {
  let pushed: Uint8Array[] = []
  let current = artwork
  let driver = generation(
    {
      query: (query) =>
        Promise.resolve(
          query.includes('?session') ? [] : [{
            entity: { eid: 'answer' },
            output: {},
            attachment: { artifact: 'generated' },
          }],
        ),
      apply: () => Promise.reject(new Error('unexpected write')),
    },
    {
      async fetch(path, init) {
        if (path === '/blob/generated') {
          return new Response(
            new ReadableStream({
              start(out) {
                for (let at = 0; at < current.length; at += 7) {
                  out.enqueue(current.subarray(at, at + 7))
                }
                out.close()
              },
            }),
          )
        }
        assertEquals(path, '/pay/artifacts?buyer=buyer')
        assert(init?.body instanceof ReadableStream)
        pushed.push(new Uint8Array(await new Response(init.body).arrayBuffer()))
        return Response.json({ eid: 'artwork' })
      },
    },
    { person: 'buyer' },
    { preview: false, font: '', printer: '', model: '' },
  )
  let result = await driver.result('job')
  assertEquals(result, {
    artwork: { blob: 'artwork', hash: 'artwork', mime: 'image/png' },
  })
  assertEquals(pushed, [artwork])
  current = artwork.subarray(0, artwork.length - 2)
  await assertRejects(() => driver.result('job'), Error, 'PNG')
  assertEquals(pushed, [artwork])
})
