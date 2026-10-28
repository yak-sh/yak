// The outbound half as a host composes it: a transport nobody can build is a
// graph whose letters wait, never a host that will not come up — and the first
// process that can send sends them, once.

import { system } from '@yaks/fp'
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Bundle,
  type Comp,
  graph,
  type ReadTx,
  type Storage,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effectDoc, effects as registry, type Handlers } from '@yaks/effects'
import { docs } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { effects } from './effects.ts'
import type { Transport } from './options.ts'
import { mailbox } from './plugin.ts'
import { club, committed, noon } from './testing.ts'
import { type Sender, sending } from './send.ts'
import { stash } from './stash.ts'
import type { Host } from '@yaks/host'

let unarmed = { via: 'cloudflare', account: 'a' } as Transport

// The club with a pool, so what one process writes another can run.
let pooled = loadVocab([...club.docs, effectDoc])

// A process over `storage`, working the pool with the code it was given.
let proc = async (storage: Storage, handlers: Handlers, at = 0) => {
  let reports: unknown[] = []
  let fx = registry(pooled, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (error) => reports.push(error),
    tries: 1,
    owes: 'declared',
    clock: { ...system, now: () => at },
    // A declaration's own tries outrank `tries`: spend them all at once.
    backoff: () => 0,
  })
  fx.handle(handlers)
  let g = graph({
    storage,
    vocab: pooled,
    plugins: [fx, docs(), mailbox({ domain: 'books.example' })],
  })
  await fx.work(g)
  return Object.assign(g, { fx, storage, reports })
}

// The process that wrote the letter, with whatever code the test gives it.
let rig = (handlers: Handlers) => proc(ram(pooled), handlers)

// Another process can consume the same pending debt once it becomes eligible.
let resume = async (g: Awaited<ReturnType<typeof rig>>, sender: Sender) => {
  let next = await proc(g.storage, {
    mail_post: sending({ sender, now: noon }),
  }, 60_000)
  await next.fx.idle()
}

let ana = {
  entity: { eid: 'p-ana' },
  person: { name: 'Ana' },
  email: { address: 'ana@books.example' },
}
let letter = (eid: string, extra: Bundle = { entity: { eid } }): Bundle => ({
  ...extra,
  entity: { eid },
  doc: { title: 'Potluck Friday', body: 'Bring a dish.' },
  mail: { from: 'hello@books.example' },
  deliver: { to: 'p-ana', ...(extra.deliver as Comp) },
})

let read = async (g: { read: (q: string) => unknown }, eid: string) =>
  ((await g.read(`.entity.eid=${eid}`)) as Bundle[])[0]

// Committed letters at the handler boundary keep sender checks independent
// of the pool's scheduling and startup work.
let lent = committed([ana], pooled)
let handOver = async (code: Handlers, eid: string) => {
  lent.tx.patch([letter(eid)])
  await code.mail_post(
    {
      kind: 'created',
      name: 'deliver',
      entity: { eid },
    },
    lent.tx,
    lent.write,
  )
  return (await lent.tx.get([eid]))[0]
}

test('a host sender delivers once and records its receipt', async () => {
  let box = stash()
  let code = effects({ senders: { platform: box } }, {
    sender: { via: 'platform' },
  })
  let sent = await handOver(code, 'lent-once')
  assertEquals(box.sent.map((m) => [m.to, m.subject]), [
    ['ana@books.example', 'Potluck Friday'],
  ])
  assertEquals((sent.mail as Comp).message_id, 'stash-1')
  assert(sent.delivered)
  await handOver(code, 'lent-once')
  assertEquals(box.sent.length, 1)
})

test('host sender names take precedence over built-in senders', async () => {
  for (let via of ['cloudflare', 'stash']) {
    let box = stash()
    let sent = await handOver(
      effects({ senders: { [via]: box } }, { sender: { via } }),
      `lent-${via}`,
    )
    assert(sent.delivered)
    assertEquals(box.sent.length, 1)
  }
})

test('the built-in stash retains receipts across delivery attempts', async () => {
  let code = effects(null, { sender: { via: 'stash' } })
  let first = await handOver(code, 'stash-first')
  let second = await handOver(code, 'stash-second')
  assertEquals((first.mail as Comp).message_id, 'stash-1')
  assertEquals((second.mail as Comp).message_id, 'stash-2')
})

test('an unavailable host sender waits and can arrive on the next attempt', async () => {
  let host: Pick<Host, 'senders'> = { senders: {} }
  let code = effects(host, { sender: { via: 'platform' } })
  await assertRejects(
    () => handOver(code, 'lent-late'),
    Error,
    'no sender called',
  )
  let [waiting] = await lent.tx.get(['lent-late'])
  assertEquals(waiting.deliver, {
    to: 'p-ana',
    waiting: 'no sender called "platform"',
  })
  let box = stash()
  host.senders = { platform: box }
  let sent = await handOver(code, 'lent-late')
  assert(sent.delivered)
  assert((sent.deliver as Comp).waiting == null)
  assertEquals(box.sent.length, 1)
})

test('inherited object names cannot select a host sender', async () => {
  let code = effects({ senders: {} }, { sender: { via: 'constructor' } })
  await assertRejects(
    () => handOver(code, 'lent-unknown'),
    Error,
    'no sender called "constructor"',
  )
  let [kept] = await lent.tx.get(['lent-unknown'])
  assertEquals((kept.deliver as Comp).tried, undefined)
  assertEquals(kept.bounced, undefined)
})

test('a transport that is named and complete sends', async () => {
  let code = effects(null, { sender: { via: 'stash' } })
  let g = await rig(code)
  await g.apply([ana, letter('e-one')])
  await g.fx.idle()
  assert((await read(g, 'e-one')).delivered)
  assertEquals(g.reports, [])
})

// Saving an envelope and asking to send it are separate graph writes. Keep
// the completed pool work beside waitingSender below; assertions inspect the
// transport and committed outcome without timing the fixture's startup.
let lateBox = stash()
let lateRecipient = await rig(effects({ senders: { platform: lateBox } }, {
  sender: { via: 'platform' },
}))
let draft = letter('e-draft')
delete draft.deliver
await lateRecipient.apply([ana, draft])
await lateRecipient.fx.idle()
let beforeRecipient = lateBox.sent.length
await lateRecipient.apply([{ entity: draft.entity, deliver: { to: 'p-ana' } }])
await lateRecipient.fx.idle()
let sentDraft = await read(lateRecipient, 'e-draft')
await lateRecipient.apply([{
  entity: draft.entity,
  doc: { body: 'Bring dessert.' },
}])
await lateRecipient.fx.idle()
test('adding a recipient to a saved letter sends it once', () => {
  assertEquals(beforeRecipient, 0)
  assertEquals(lateBox.sent.map((m) => [m.to, m.subject]), [
    ['ana@books.example', 'Potluck Friday'],
  ])
  assert(sentDraft.delivered)
  assertEquals(lateRecipient.reports, [])
})

let missing = await rig(effects(null, { sender: unarmed }))
await missing.apply([ana, {
  entity: { eid: 'e-in' },
  mail: { from: 'bea@out.example', to: 'hello@books.example' },
}])
await missing.fx.idle()
let inboundReports = [...missing.reports]
await missing.apply([letter('e-one'), letter('e-two')])
await missing.fx.idle()
let pending = await missing.read(
  '.effect.handler=mail_post .effect.state=pending',
)
let waiting = await missing.get(['e-one', 'e-two'])
test('missing credentials keep every owed letter visibly pending without failures', () => {
  assertEquals(inboundReports, [])
  assertEquals(missing.reports, [])
  assert(pending.length > 0)
  assert(pending.every((b) => (b.effect as Comp).attempts == 0))
  for (let kept of waiting) {
    assert(
      String((kept.deliver as Comp).waiting).includes(
        'waiting for credentials',
      ),
    )
    assertEquals((kept.deliver as Comp).tried, undefined)
    assertEquals(kept.delivered, undefined)
    assertEquals(kept.bounced, undefined)
  }
})

let waitingSender = await rig(effects(null))
await waitingSender.apply([ana, letter('e-one')])
await waitingSender.fx.idle()
test('no configured sender leaves an outbound letter waiting rather than silently done', async () => {
  let g = waitingSender
  assertEquals((await read(g, 'e-one')).deliver, {
    to: 'p-ana',
    waiting: 'waiting for a configured sender',
  })
  assertEquals(g.reports, [])
})

let repaired = await rig(effects(null, { sender: unarmed }))
await repaired.apply([ana, letter('e-one')])
await repaired.fx.idle()
let repairedBox = stash()
await resume(repaired, repairedBox)
let repairedSent = await read(repaired, 'e-one')
await resume(repaired, repairedBox)
test('pending delivery survives reopening and sends once after configuration repair', () => {
  assertEquals(repairedBox.sent.map((m) => m.subject), ['Potluck Friday'])
  assertEquals(repairedSent.delivered, { at: noon() })
  assertEquals((repairedSent.mail as Comp).message_id, 'stash-1')
  assertEquals((repairedSent.deliver as Comp).tried, noon())
  assert((repairedSent.deliver as Comp).waiting == null)
})

test('one running handler re-reads its sender after configuration arrives', async () => {
  let options: { sender: Transport } = { sender: unarmed }
  let code = effects(null, options)
  let g = await rig(code)
  await g.apply([ana, letter('e-one')])
  await g.fx.idle()
  options.sender = { via: 'stash' }
  // The existing pending run becomes eligible in another process.
  let next = await proc(g.storage, code, 60_000)
  await next.fx.idle()
  let sent = await read(g, 'e-one')
  assert(!!sent.delivered)
  assert((sent.deliver as Comp).waiting == null)
  assertEquals(next.reports, [])
})

test('an unresolved recipient bounces visibly and is also reported', async () => {
  let g = await rig(effects(null, { sender: { via: 'stash' } }))
  await g.apply([{
    entity: ana.entity,
    person: ana.person,
  }, letter('e-one')])
  await g.fx.idle()
  let row = await read(g, 'e-one')
  assert(String((row.bounced as Comp).reason).includes('no address on file'))
  assertEquals((row.deliver as Comp).tried, undefined)
  assertEquals(g.reports.length, 1)
})

test('a transport rejection records a bounce and reaches the effect reporter without a resend', async () => {
  let calls = 0
  let error = new Error('mail provider unavailable')
  let g = await rig({
    mail_post: sending({
      sender: {
        send: () => {
          calls++
          return Promise.reject(error)
        },
      },
    }),
  })
  await g.apply([ana, letter('e-one')])
  await g.fx.idle()
  assertEquals(
    (await read(g, 'e-one')).bounced &&
      ((await read(g, 'e-one')).bounced as Comp).reason,
    error.message,
  )
  assertEquals(g.reports, [error])
  let next = await proc(g.storage, {
    mail_post: sending({
      sender: {
        send: () => {
          calls++
          return Promise.resolve({})
        },
      },
    }),
  })
  await next.fx.idle()
  assertEquals(calls, 1)
})

let handedOver = await rig({})
await handedOver.apply([
  ana,
  letter('e-lost', {
    entity: { eid: 'e-lost' },
    deliver: { tried: noon() },
  }),
  letter('e-sent'),
  {
    entity: { eid: 'e-sent' },
    delivered: { at: noon() },
  },
], { trusted: true })
let handedBox = stash()
await resume(handedOver, handedBox)
test('a letter handed over and never settled is not handed over again', () => {
  assertEquals(handedBox.sent, [])
})

// The sending handler's boundary: committed rows and a durable write callback.
let orderingEvent = {
  kind: 'created' as const,
  entity: { eid: 'e-one' },
  name: 'mail',
}
test('the letter is marked tried before the transport sees it', async () => {
  let at: unknown[] = []
  let { tx, write } = committed([ana, letter('e-one')], pooled)
  await sending({
    now: noon,
    sender: {
      send: async () => {
        at.push(((await tx.get(['e-one']))[0].deliver as Comp).tried)
        return { id: 'r-1' }
      },
    },
  })(orderingEvent, tx, write)
  assertEquals(at, [noon()])
})

// A pooled mail and recipient creation can start two handlers together. Both
// read the untried letter before either records its hand-over.
let contestedStore = graph({ storage: ram(pooled), vocab: pooled })
await contestedStore.apply([
  ana,
  {
    entity: { eid: 'e-original' },
    mail: { message_id: 'original@example.com' },
  },
  {
    ...letter('e-contested'),
    mail: { from: 'hello@books.example', reply_to: 'e-original' },
  },
], { trusted: true })
let contestedTx: ReadTx = {
  ...contestedStore.outside,
  get: (eids, comps) =>
    Promise.resolve(contestedStore.outside.get(eids, comps)),
}
let concurrent = async () => {
  let box = stash()
  let send = sending({ sender: box, now: noon })
  let write = (rows: Bundle[]) =>
    Promise.resolve().then(() => contestedStore.apply(rows, { trusted: true }))
  await Promise.all(['mail', 'deliver'].map((name) =>
    send(
      {
        kind: 'created',
        entity: { eid: 'e-contested' },
        name,
      },
      contestedTx,
      write,
    )
  ))
  return box
}
let contestedBox = await concurrent()
let contestedLetter = (await contestedStore.get(['e-contested']))[0]
test('concurrent delivery handlers hand one letter to the sender once', () => {
  assertEquals(contestedBox.sent.length, 1)
  assertEquals(contestedBox.last()?.replyTo, 'original@example.com')
  assertEquals((contestedLetter.mail as Comp).message_id, 'stash-1')
  assert(contestedLetter.delivered)
  assertEquals(contestedLetter.bounced, undefined)
})
