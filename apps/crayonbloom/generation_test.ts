import { assertEquals, assertThrows } from '@std/assert'
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
    model: 'gpt-image-2.5-flare',
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
  let [width, height] = sending.input.size.split('x').map(Number)
  assertEquals(
    checkedImage(
      encode({
        width,
        height,
        data: new Uint8Array(width * height).fill(255),
        channels: 1,
      }),
      sending.input.size,
    ).width,
    width,
  )
  let tiny = encode({
    width: 8,
    height: 8,
    data: new Uint8Array(64),
    channels: 1,
  })
  assertThrows(
    () => checkedImage(tiny, sending.input.size),
    Error,
    'different size',
  )
})
