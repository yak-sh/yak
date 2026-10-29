import { equal, test } from '@yaks/testing'
import { lines } from './collector.ts'

test('collector lines preserve UTF-8 split across chunks and a final response without newline', async () => {
  let bytes = new TextEncoder().encode('α\nβ\nlast')
  let stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (let byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    },
  })
  equal(await Array.fromAsync(lines(stream)), ['α', 'β', 'last'])
})
