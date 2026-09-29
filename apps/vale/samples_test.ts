// Hosted sound rows name the blob the player hears; the listening set keeps
// its reviewed clips even if a builder has a candidate with the same name.
import { assertEquals, assertStrictEquals } from '@std/assert'
import { blendLoop, catalog, load, loaded, SAMPLES } from './samples.ts'

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

Deno.test('hosted audio outputs supply clips without replacing the listening set', () => {
  let builds = [
    {
      entity: { eid: 'water-build' },
      build: {
        match: '["water"]',
        key: 'current',
        variant: 'main',
        stale: false,
      },
    },
    {
      entity: { eid: 'forge-build' },
      build: {
        match: '["forge"]',
        key: 'current',
        variant: 'main',
        stale: false,
      },
    },
    {
      entity: { eid: 'letter-build' },
      build: {
        match: '["letter"]',
        key: 'current',
        variant: 'main',
        stale: false,
      },
    },
    {
      entity: { eid: 'old-build' },
      build: { match: '["old"]', key: 'new', variant: 'main', stale: false },
    },
    {
      entity: { eid: 'stale-build' },
      build: { match: '["stale"]', key: 'same', variant: 'main', stale: true },
    },
    {
      entity: { eid: 'shadow-build' },
      build: {
        match: '["shadow"]',
        key: 'same',
        variant: 'shadow:test',
        stale: false,
      },
    },
  ]
  let sounds = ['water', 'forge', 'letter', 'old', 'stale', 'shadow']
    .map((name) => ({ entity: { eid: name }, sfx: { name } }))
  let artifacts = [
    ['water-blob', 'audio/mpeg'],
    ['new-forge', 'audio/mpeg'],
    ['not-a-sound', 'text/plain'],
    ['old-blob', 'audio/mpeg'],
    ['stale-blob', 'audio/mpeg'],
    ['shadow-blob', 'audio/mpeg'],
  ].map(([address, media_type]) => ({
    entity: { eid: address },
    artifact: { address, media_type },
  }))
  assertEquals(
    catalog(
      [
        {
          entity: { eid: 'water-output' },
          built: {
            build: 'water-build',
            key: 'current',
            artifact: 'water-blob',
          },
        },
        {
          entity: { eid: 'forge-output' },
          built: {
            build: 'forge-build',
            key: 'current',
            artifact: 'new-forge',
          },
        },
        {
          entity: { eid: 'letter-output' },
          built: {
            build: 'letter-build',
            key: 'current',
            artifact: 'not-a-sound',
          },
        },
        {
          entity: { eid: 'old-output' },
          built: { build: 'old-build', key: 'old', artifact: 'old-blob' },
        },
        {
          entity: { eid: 'stale-output' },
          built: { build: 'stale-build', key: 'same', artifact: 'stale-blob' },
        },
        {
          entity: { eid: 'shadow-output' },
          built: {
            build: 'shadow-build',
            key: 'same',
            artifact: 'shadow-blob',
          },
        },
      ],
      builds,
      sounds,
      artifacts,
    ),
    { water: 'water-blob' },
  )
})

Deno.test('an ambient overlap meets at neighboring source samples', () => {
  let input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7])
  let output = blendLoop(input, 2)
  assertEquals(output.length, 6)
  assertEquals(output[0], 4)
  assertEquals(output[5], 5)
})
