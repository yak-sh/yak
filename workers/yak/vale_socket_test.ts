/// <reference lib="deno.ns" />
// Vale's page opens several short watches and then long village and deal
// watches. The whole set must survive the Store socket's attachment limit.

import { assert, assertEquals } from '@std/assert'
import { type Frame, subscriptions } from '@yaks/api'
import { sockets, storage, type Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { graph } from '@yaks/graph'
import { areaOf, looksOf } from '../../apps/vale/area.ts'
import { GIVERS } from '../../apps/vale/quests.ts'
import { eidOf } from '../../apps/vale/villagers.ts'
import words from '../../apps/vale/vocab.json' with { type: 'json' }
import { appVocab } from './vocab.ts'

let hero = '12345678-1234-1234-1234-123456789abc'
let level = 'mossvale'
let area = areaOf(128, 128, 120)
let eids = GIVERS.filter((g) => g.level == level).map((g) => eidOf(g.id))

let watches = () => {
  let q = JSON.stringify(hero)
  let own = [
    `.slain.by=${q}`,
    `.item.owner=${q}&?gathered&?crafted`,
    ...[
      'used.by',
      'upgraded.by',
      'journal.player',
      'equip.player',
      'learned.player',
      'respec.player',
      'fire.player',
    ]
      .map((name) => `.${name}=${q}`),
    `.directive.player=${q}&?created&?companion&.order=-created.at&.limit=10`,
    `.teleport_request.player=${q}&?created&.order=-created.at&.limit=10`,
  ]
  let by = (name: string) => `.${name}.villager=${eids.join(',')}&?created`
  return [
    area.query,
    looksOf(area, hero),
    ...own,
    `.eid=${q}&?created&*`,
    '.tool.name=think',
    `.villager.level=${JSON.stringify(level)}&*`,
    `.entry.session=${
      eids.join(',')
    }&.output&?content&?answer&?created&.order=-created.at&.limit=60`,
    `.going.villager=${eids.join(',')}&?created&.order=-created.at&.limit=60`,
    `.chat.level=${
      JSON.stringify(level)
    }&?doc&?created&.order=-created.at&.limit=60`,
    ...['deal', 'agreed', 'handed', 'declined'].map(by),
  ]
}

Deno.test('Vale watches fit and recover after Store hibernation', () => {
  let db = durable(), vocab = appVocab(words)
  let store = storage(db, vocab)
  store.install()
  let live: Wire[] = []
  let ctx = {
    storage: db,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
  let open = () => sockets(subscriptions(graph({ storage: store, vocab })), ctx)
  let ws = wire()
  live.push(ws)
  let first = open()
  let queries = watches()
  for (let [i, query] of queries.entries()) {
    let id = `s${i + 1}`
    first.message(ws, JSON.stringify({ subscribe: query, id, acks: true }))
    let frame = ws.sent.at(-1)!
    assertEquals(frame.id, id)
    assertEquals(frame.refused, undefined)
    first.message(ws, JSON.stringify({ ack: frame.ack }))
  }
  assert((ws.deserializeAttachment() as { subref?: string }).subref)

  ws.sent.length = 0
  let woken = open()
  woken.wake()
  for (let [i] of queries.entries()) {
    let frame = ws.sent.at(-1)!
    assertEquals(frame.id, `s${i + 1}`)
    assertEquals(frame.refused, undefined)
    assertEquals(frame.reset, true)
    woken.message(ws, JSON.stringify({ ack: frame.ack }))
  }
  assertEquals(ws.sent.length, queries.length)
  db[Symbol.dispose]()
})

let wire = () => {
  let sent: Frame[] = []
  let held: unknown = null
  return {
    sent,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (value: unknown) => {
      let encoded = JSON.stringify(value)
      assert(new TextEncoder().encode(encoded).length <= 2048)
      held = JSON.parse(encoded)
    },
    deserializeAttachment: () => held,
  }
}
