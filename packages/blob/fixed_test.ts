import { equal, test, tick } from '@yaks/testing'
import { fixed } from './fixed.ts'

test('explicit cleanup finishes an active fixed-length reader', async () => {
  let started = Promise.withResolvers<void>()
  let source = new ReadableStream<Uint8Array>({
    pull: () => started.resolve(),
  }, { highWaterMark: 0 })
  let upload = fixed(source, 16, () => undefined)
  let ended: ReadableStreamReadResult<Uint8Array> | undefined
  let reading = upload.body.getReader().read().then((chunk) => ended = chunk)
  await started.promise
  await upload.cancel('upload rejected')
  await tick()
  equal(ended, { done: true, value: undefined })
  await reading
})
