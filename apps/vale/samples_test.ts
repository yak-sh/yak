// Hosted sound rows name every clip, and replacing an output changes playback.
import { test } from '@yaks/testing'
import { assertEquals, assertStrictEquals } from '@std/assert'
import { shop } from '../../packages/builders/testing.ts'
import vale from './vocab.json' with { type: 'json' }
import {
  accept,
  blendLoop,
  catalog,
  load,
  loaded,
  type Row,
  SOUNDS,
} from './samples.ts'

test('sound samples retry a missing blob and share a successful load', async () => {
  accept([
    {
      entity: { eid: 'test-output' },
      built: { build: 'test-build', artifact: 'test-clip' },
    },
    { entity: { eid: 'test-build' }, build: { for: 'test-sound' } },
    { entity: { eid: 'test-sound' }, sfx: { name: 'hammer' } },
    {
      entity: { eid: 'test-clip' },
      artifact: { address: 'test-hammer', media_type: 'audio/mpeg' },
    },
  ])
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
      `https://yourname.yaks.app/vale/api/blob/test-hammer`,
      `https://yourname.yaks.app/vale/api/blob/test-hammer`,
    ])
  } finally {
    globalThis.fetch = fetchWas
    if (doc) Object.defineProperty(globalThis, 'document', doc)
    else Reflect.deleteProperty(globalThis, 'document')
    if (report) Object.defineProperty(globalThis, 'reportError', report)
  }
})

test('hosted audio outputs supply every sound clip', () => {
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
    { water: 'water-blob', forge: 'forge-blob' },
  )
})

test('an ambient overlap meets at neighboring source samples', () => {
  let input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7])
  let output = blendLoop(input, 2)
  assertEquals(output.length, 6)
  assertEquals(output[0], 4)
  assertEquals(output[5], 5)
})

test('the sound query projects current main outputs through qualified references', async () => {
  let { g, failed } = await shop({}, [{ $defs: { sfx: vale.$defs.sfx } }])
  await g.apply([
    { entity: { eid: 'sound' }, sfx: { name: 'contraction-audio' } },
    {
      entity: { eid: 'clip' },
      artifact: { address: 'audio-blob', media_type: 'audio/mpeg', size: 3 },
    },
    ...['main', 'shadow', 'stale'].flatMap((variant) => [
      {
        entity: { eid: `${variant}-build` },
        build: {
          for: 'sound',
          variant: variant == 'shadow' ? 'candidate' : 'main',
          key: 'current',
          stale: variant == 'stale',
        },
      },
      {
        entity: { eid: `${variant}-output` },
        built: { build: `${variant}-build`, key: 'current', artifact: 'clip' },
      },
    ]),
    {
      entity: { eid: 'old-output' },
      built: { build: 'main-build', key: 'previous', artifact: 'clip' },
    },
  ], { trusted: true })
  let rows = await g.read(SOUNDS) as Row[]
  assertEquals(rows.map((row) => row.entity.eid).toSorted(), [
    'clip',
    'main-build',
    'main-output',
    'sound',
  ])
  assertEquals(catalog(rows), { 'contraction-audio': 'audio-blob' })
  assertEquals(failed, [])
})
