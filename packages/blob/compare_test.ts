import { equal, test } from '@yaks/testing'
import { differing } from './compare.ts'
import { streamOf } from './stream.ts'

test('compare streamed bytes with an object and replay only a different body', async () => {
  let stored = new TextEncoder().encode('abcdef')
  let original = {
    size: stored.length,
    version: '1',
    read: ({ from, to } = { from: 0, to: stored.length - 1 }) =>
      Promise.resolve(streamOf(stored.slice(from, to + 1)).stream),
  }
  for (let tail of ['ef', 'ex', '', 'efg']) {
    let sent = new ReadableStream<Uint8Array>({
      start(out) {
        for (let part of ['ab', 'cd', tail]) {
          out.enqueue(new TextEncoder().encode(part))
        }
        out.close()
      },
    })
    let other = await differing(sent, original)
    equal(
      other && await new Response(other).text(),
      tail == 'ef' ? null : 'abcd' + tail,
    )
  }
})
