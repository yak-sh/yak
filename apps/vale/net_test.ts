// The page waits for all of the store's words before it opens a local graph.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { client } from '@yaks/client'
import { connect, vocabulary } from './net.ts'
import words from './vocab.json' with { type: 'json' }
import core from '../../packages/kernel/vocab.json' with { type: 'json' }

test('a vocabulary 500 recovers before the page can query created', async () => {
  using time = new FakeTime()
  let fetchBefore = globalThis.fetch
  let calls = 0
  let urls: string[] = []
  try {
    globalThis.fetch = (url) => {
      urls.push(String(url))
      return Promise.resolve(
        ++calls == 1
          ? new Response('store unavailable', { status: 500 })
          : Response.json([words, core]),
      )
    }

    let opened = false
    let opening = vocabulary(new URL('https://example.test/vale/api/'))
      .then((vocab) => {
        opened = true
        return vocab
      })
    await time.tickAsync(0)
    assertEquals(calls, 1)
    assertEquals(opened, false)
    await time.tickAsync(1000)
    let vocab = await opening
    assertEquals(calls, 2)
    assertEquals(
      urls,
      Array(2).fill('https://example.test/vale/api/vocab.json'),
    )
    assertEquals(vocab.comp('created')?.name, 'created')
    let page = client(vocab, [], { vault: false, wireVault: false })
    assertEquals(page.read('.player&.created.by="person"&*'), [])
    page.close()
  } finally {
    globalThis.fetch = fetchBefore
  }
})

test('creature builds use the server answer without matching computed current locally', async () => {
  let socket = pair().client
  let vocab = loadVocab([words, core, builderDoc])
  let page = connect(new URL('https://example.test/vale/api/'), vocab, {
    connect: () => socket,
    fetch: () => Response.json([]),
    timer: () => {},
  })
  let graph = page.client
  try {
    // There is deliberately no local computed rule for built.current.
    assertThrows(() => graph.read(SPAWN_KINDS), Error, 'built.current')
    let ready = false
    let opening = page.spawnKinds().then(() => ready = true)
    assertEquals(ready, false)
    socket.emit('open')
    let ask = socket.sent.map((frame) =>
      frame as { id: string; subscribe?: string }
    )
      .find((frame) => frame.subscribe == SPAWN_KINDS)
    assert(ask, JSON.stringify(socket.sent))
    socket.emit(
      'message',
      JSON.stringify({
        id: ask.id,
        bundles: [
          {
            entity: { eid: 'kind' },
            built: { current: true, slot: 'kind', build: 'build' },
          },
          {
            entity: { eid: 'build' },
            build: { variant: 'main', for: 'spawn' },
          },
          {
            entity: { eid: 'spawn' },
            spawned: { lvl: 1, x: 0, z: 0, roam: 2 },
          },
        ],
      }),
    )
    await opening
    assertEquals(ready, true)
    assertEquals(
      kindOf({
        entity: { eid: 'spawn' },
        spawned: { lvl: 1, x: 0, z: 0, roam: 2 },
      }),
      'kind',
    )
    socket.emit(
      'message',
      JSON.stringify({
        id: ask.id,
        bundles: [],
        gone: ['kind', 'build', 'spawn'],
      }),
    )
    assertEquals(
      kindOf({
        entity: { eid: 'spawn' },
        spawned: { lvl: 1, x: 0, z: 0, roam: 2 },
      }),
      undefined,
    )
  } finally {
    page.close()
    useSpawnKinds([])
  }
})

import { loadVocab } from '@yaks/vocab'
import { builderDoc } from '@yaks/builders/vocab'
import { pair } from '../../packages/sync/testing.ts'
import { kindOf, SPAWN_KINDS, useSpawnKinds } from './spawn.ts'
