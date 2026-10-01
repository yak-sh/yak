// Hosted sound rows name the blob the player hears; the listening set keeps
// its reviewed clips even if a builder has a candidate with the same name.
import { test } from '@yaks/testing'
import { assertEquals, assertStrictEquals } from '@std/assert'
import { blendLoop, catalog, load, loaded, SAMPLES } from './samples.ts'

test('sound samples retry a missing blob and share a successful load', async () => {
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

test('hosted audio outputs supply clips without replacing the listening set', () => {
  // One output as SOUNDS answers it: the output, then what rides beside it.
  let output = (name: string, media_type = 'audio/mpeg', sound = true) => [
    {
      entity: { eid: `${name}-output` },
      built: { build: `${name}-build`, artifact: `${name}-blob` },
    },
    { entity: { eid: `${name}-build` }, build: { for: name } },
    ...sound ? [{ entity: { eid: name }, sfx: { name } }] : [],
    {
      entity: { eid: `${name}-blob` },
      artifact: { address: `${name}-blob`, media_type },
    },
  ]
  assertEquals(
    catalog([
      ...output('water'),
      ...output('forge'),
      ...output('letter', 'text/plain'),
      ...output('figure', 'audio/mpeg', false),
    ]),
    { water: 'water-blob' },
  )
})

test('an ambient overlap meets at neighboring source samples', () => {
  let input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7])
  let output = blendLoop(input, 2)
  assertEquals(output.length, 6)
  assertEquals(output[0], 4)
  assertEquals(output[5], 5)
})
