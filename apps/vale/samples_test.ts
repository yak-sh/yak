// A missing sound leaves a procedural voice available, then a later request
// can load the blob; simultaneous callers share one fetch and decode.
import { assertEquals, assertStrictEquals } from '@std/assert'
import { load, loaded, SAMPLES } from './samples.ts'

Deno.test('sound samples retry a missing blob and share a successful load', async () => {
  let doc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let report = Object.getOwnPropertyDescriptor(globalThis, 'reportError')
  let fetchWas = globalThis.fetch
  let requests: string[] = [], failures: unknown[] = []
  let found = false
  let buffer = { duration: 1 } as AudioBuffer
  let ctx = {
    decodeAudioData: (_: ArrayBuffer) => Promise.resolve(buffer),
  } as AudioContext
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { baseURI: 'https://yourname.yaks.app/vale/' },
  })
  Object.defineProperty(globalThis, 'reportError', {
    configurable: true,
    value: (error: unknown) => failures.push(error),
  })
  globalThis.fetch = (url) => {
    requests.push(String(url))
    return Promise.resolve(
      found
        ? new Response(new Uint8Array([1, 2, 3]))
        : new Response('', { status: 404 }),
    )
  }
  try {
    assertEquals(await load(ctx, 'hammer'), null)
    assertEquals(loaded(ctx, 'hammer'), undefined)
    assertEquals(failures.length, 1)
    found = true
    let [first, second] = await Promise.all([
      load(ctx, 'hammer'),
      load(ctx, 'hammer'),
    ])
    assertStrictEquals(first, buffer)
    assertStrictEquals(second, buffer)
    assertStrictEquals(loaded(ctx, 'hammer'), buffer)
    assertStrictEquals(await load(ctx, 'hammer'), buffer)
    assertEquals(requests, [
      `https://yourname.yaks.app/vale/api/blob/${SAMPLES.hammer}`,
      `https://yourname.yaks.app/vale/api/blob/${SAMPLES.hammer}`,
    ])
  } finally {
    globalThis.fetch = fetchWas
    if (doc) Object.defineProperty(globalThis, 'document', doc)
    else Reflect.deleteProperty(globalThis, 'document')
    if (report) Object.defineProperty(globalThis, 'reportError', report)
  }
})
