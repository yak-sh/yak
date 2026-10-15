/// <reference lib="deno.ns" />
// A held deletion's server answer and browser-owned companions are one outcome.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { sync } from './sync.ts'
import { pair } from './testing.ts'
import { WriteRefused, WriteUnknown } from './outbound.ts'

let vocab = loadVocab({
  $defs: {
    item: { component: true, properties: { name: { type: 'string' } } },
    spent: { component: true, properties: { gold: { type: 'number' } } },
    Panel: {
      component: true,
      sync: 'none',
      properties: { open: { type: 'boolean' } },
    },
    command: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      properties: { action: { type: 'string' } },
    },
    reply: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      properties: { message: { type: 'string' } },
    },
  },
})
let fixture = () => {
  let g = graph({ vocab, storage: ram(vocab) })
  g.apply([{ entity: { eid: 'tower' }, item: { name: 'Ranger' } }, {
    entity: { eid: 'order' },
    command: { action: 'sell' },
  }])
  let respond!: (response: Response) => void
  let reject!: (error: Error) => void
  let response = new Promise<Response>((yes, no) => {
    respond = yes
    reject = no
  })
  let sockets = pair()
  let wire = sync(g, {
    url: 'https://held.test',
    connect: () => sockets.client,
    fetch: () => response,
    timer: () => {},
    report: () => {},
  })
  wire.open()
  sockets.client.emit('open')
  let result = wire.apply([
    { entity: { eid: 'tower' }, $delete: true },
    { entity: { eid: 'sale' }, spent: { gold: -94 } },
    { entity: { eid: 'order' }, command: null, reply: { message: 'Sold' } },
    { entity: { eid: 'panel' }, Panel: { open: false } },
  ])
  let row = (id: string) => (g.get([id]) as Bundle[])[0]
  return { g, wire, respond, reject, result, row, sent: sockets.client.sent }
}
let accepted = fixture(), refused = fixture(), unknown = fixture()
let pending = fixture()

test('a held delete keeps page and peer companions unchanged before acceptance', async () => {
  equal(pending.row('order')?.command, { action: 'sell' })
  equal(pending.row('order')?.reply, undefined)
  equal(pending.row('panel'), undefined)
  equal(pending.row('tower')?.item, { name: 'Ranger' })
  pending.respond(
    Response.json({ error: 'Refused', message: 'Cancelled' }, { status: 403 }),
  )
  try {
    await pending.result
  } catch { /* deliberate refusal reaps the held request */ }
  pending.wire.close()
})

test('an accepted held delete applies and relays its companions once', async () => {
  accepted.respond(Response.json([
    { entity: { eid: 'tower' }, tombstone: {} },
    { entity: { eid: 'sale' }, spent: { gold: -94 } },
  ]))
  let answer = await accepted.result
  equal(accepted.row('order')?.command, undefined)
  equal(accepted.row('order')?.reply, { message: 'Sold' })
  equal(accepted.row('panel')?.Panel, { open: false })
  equal(accepted.row('tower')?.item, undefined)
  equal(accepted.row('sale')?.spent, { gold: -94 })
  let relays = accepted.sent.flatMap((frame) =>
    (frame as { relay?: Bundle[] }).relay ?? []
  )
  equal(relays.filter((b) => 'command' in b), [{
    entity: { eid: 'order' },
    command: null,
  }])
  equal(relays.filter((b) => 'reply' in b), [{
    entity: { eid: 'order' },
    reply: { message: 'Sold' },
  }])
  ok(answer.some((b) => b.entity.eid === 'order' && !!b.reply))
  accepted.wire.close()
})

test('a refused held delete does not apply or relay its companions', async () => {
  refused.respond(
    Response.json({ error: 'Refused', message: 'Not your tower' }, {
      status: 403,
    }),
  )
  let error: unknown
  try {
    await refused.result
  } catch (caught) {
    error = caught
  }
  ok(error instanceof WriteRefused)
  equal(refused.row('order')?.command, { action: 'sell' })
  equal(refused.row('order')?.reply, undefined)
  equal(refused.row('panel'), undefined)
  equal(refused.row('tower')?.item, { name: 'Ranger' })
  equal(
    refused.sent.some((frame) => !!(frame as { relay?: Bundle[] }).relay),
    false,
  )
  refused.wire.close()
})

test('an unknown held delete does not apply or relay its companions', async () => {
  unknown.reject(new Error('Response lost'))
  let error: unknown
  try {
    await unknown.result
  } catch (caught) {
    error = caught
  }
  ok(error instanceof WriteUnknown)
  equal(unknown.row('order')?.command, { action: 'sell' })
  equal(unknown.row('order')?.reply, undefined)
  equal(unknown.row('panel'), undefined)
  equal(unknown.row('tower')?.item, { name: 'Ranger' })
  equal(
    unknown.sent.some((frame) => !!(frame as { relay?: Bundle[] }).relay),
    false,
  )
  unknown.wire.close()
})
