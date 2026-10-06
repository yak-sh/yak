// Merely playing near villagers must not persist model turns or a clock.
import { equal, test } from '@yaks/testing'
import { born } from './villagers.ts'
import { GIVERS } from './quests.ts'

test('a villager is born with a transcript but no autonomous scheduled turn', () => {
  let row = born(GIVERS[0])
  equal(row.session, {})
  equal('wake' in row, false)
  equal('call' in row, false)
})

import { graph, Stale } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { toolEid } from '@yaks/tools'
import { appVocab } from '../../workers/yak/vocab.ts'
import words from './vocab.json' with { type: 'json' }
import { retired } from './villagers.ts'

test('legacy clock retirement preserves dialogue and a changed human call', async () => {
  let vocab = appVocab(words), g = graph({ vocab, storage: ram(vocab) })
  let villager = born(GIVERS[0]), id = villager.entity.eid
  await g.storage.tx((tx) =>
    tx.patch([
      {
        ...villager,
        call: { to: toolEid('think'), args: { villager: id } },
        wake: { every: '5m' },
      },
      {
        entity: { eid: 'human-line' },
        entry: { session: id, seq: 1 },
        content: { body: 'Hello Wren' },
      },
    ])
  )
  let [held] = await g.get([id])
  let patch = retired(held)!
  await g.apply([patch])
  equal((await g.get([id]))[0].session, {})
  equal((await g.get(['human-line']))[0].content, { body: 'Hello Wren' })
  equal(retired((await g.get([id]))[0]), null)
  await g.storage.tx((tx) =>
    tx.patch([{ ...held, call: { to: toolEid('tell') } }])
  )
  equal(retired((await g.get([id]))[0]), null)
  let refused = false
  try {
    await g.apply([patch])
  } catch (e) {
    refused = e instanceof Stale
  }
  equal(refused, true)
})

import { workerOf } from './worker.js'
import { flat } from './terrain.ts'

test('legacy think worker retires its named clock once without touching dialogue', async () => {
  let vocab = appVocab(words), g = graph({ vocab, storage: ram(vocab) })
  let villager = born(GIVERS[0]), id = villager.entity.eid
  await g.storage.tx((tx) =>
    tx.patch([
      { ...villager, call: { to: toolEid('think') }, wake: { every: '5m' } },
      {
        entity: { eid: 'human-line' },
        entry: { session: id, seq: 1 },
        content: { body: 'Hello Wren' },
      },
    ])
  )
  let writes = 0
  let door = {
    fetch: async (path: string, init?: RequestInit) => {
      if (path.startsWith('query?')) {
        return Response.json(
          await g.read(new URL('http://store/' + path).searchParams.get('q')!),
        )
      }
      writes++
      let body = JSON.parse(String(init?.body))
      return Response.json(await g.apply(body.entities))
    },
  }
  let worker = workerOf(flat(5))
  for (let i = 0; i < 2; i++) {
    let response = await worker.fetch(
      new Request('http://vale/villager/retire', {
        method: 'POST',
        body: JSON.stringify({ villager: id }),
      }),
      { APP: door, STORE: door },
    )
    equal(response.status, 200)
    equal((await response.json()).retired, i == 0)
  }
  equal(writes, 1)
  equal((await g.get(['human-line']))[0].content, { body: 'Hello Wren' })
})
