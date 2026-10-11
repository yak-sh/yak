// The outbound half as a host composes it: a transport nobody can build is a
// graph whose letters wait, never a host that will not come up — and the first
// process that can send sends them, once.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Bundle,
  type Comp,
  detached,
  graph,
  type Storage,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effectDoc, effects as registry, type Handlers } from '@yaks/effects'
import { docs } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { effects } from './effects.ts'
import type { Transport } from './options.ts'
import { mailbox } from './plugin.ts'
import { club, noon } from './testing.ts'
import { type Sender, sending } from './send.ts'
import { stash } from './stash.ts'
import type { Host } from '@yaks/host'

let unarmed = { via: 'cloudflare', account: 'a' } as Transport

// The club with a pool, so what one process writes another can run.
let pooled = loadVocab([...club.docs, effectDoc])

// A process over `storage`, working the pool with the code it was given.
let proc = async (storage: Storage, handlers: Handlers) => {
  let reports: unknown[] = []
  let fx = registry(pooled, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (error) => reports.push(error),
    tries: 1,
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

// Another process opening the same graph with a sender, and coming up: the
// letters still owed are swept and sent.
let sweep = async (g: Awaited<ReturnType<typeof rig>>, sender: Sender) => {
  let next = await proc(g.storage, {
    mail_post: sending({ sender, now: noon }),
  })
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
let lentTx = detached(ram(pooled))
lentTx.patch([ana])
let handOver = async (code: Handlers, eid: string) => {
  lentTx.patch([letter(eid)])
  let write = async (rows: Bundle[]) => {
    let written = await lentTx.patch(rows)
    return lentTx.get(written.map((entity) => entity.eid))
  }
  await code.mail_post(
    {
      kind: 'created',
      name: 'deliver',
      entity: { eid },
    },
    lentTx,
    write,
  )
  return (await lentTx.get([eid]))[0]
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
  let [waiting] = await lentTx.get(['lent-late'])
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
  let [kept] = await lentTx.get(['lent-unknown'])
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

test('missing credentials leave every owed letter visibly waiting and report failures', async () => {
  let g = await rig(effects(null, { sender: unarmed }))
  await g.apply([ana, {
    entity: { eid: 'e-in' },
    mail: { from: 'bea@out.example', to: 'hello@books.example' },
  }])
  await g.fx.idle()
  assertEquals(g.reports, [])
  await g.apply([letter('e-one'), letter('e-two')])
  await g.fx.idle()
  assertEquals(g.reports.length, 2)
  assert(g.reports.every((e) => String(e).includes('waiting for credentials')))
  for (let eid of ['e-one', 'e-two']) {
    let kept = await read(g, eid)
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
  assertEquals(g.reports.length, 1)
})

test('the ordinary startup sweep sends a waiting letter once and clears the reason', async () => {
  let g = await rig(effects(null, { sender: unarmed }))
  await g.apply([ana, letter('e-one')])
  await g.fx.idle()
  let box = stash()
  await sweep(g, box)
  assertEquals(box.sent.map((m) => m.subject), ['Potluck Friday'])
  let sent = await read(g, 'e-one')
  assertEquals(sent.delivered, { at: noon() })
  assertEquals((sent.mail as Comp).message_id, 'stash-1')
  assertEquals((sent.deliver as Comp).tried, noon())
  assert((sent.deliver as Comp).waiting == null)
  await sweep(g, box)
  assertEquals(box.sent.length, 1)
})

test('one running handler re-reads its sender after configuration arrives', async () => {
  let options: { sender: Transport } = { sender: unarmed }
  let code = effects(null, options)
  let g = await rig(code)
  await g.apply([ana, letter('e-one')])
  await g.fx.idle()
  options.sender = { via: 'stash' }
  // Use the same factory result in another process: the startup sweep is
  // ordinary recovery, not a hand-written transport send.
  let next = await proc(g.storage, code)
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
test('a letter handed over and never settled is not handed over again', async () => {
  let box = stash()
  await sweep(handedOver, box)
  assertEquals(box.sent, [])
})

// The sending handler's boundary: committed rows and a durable write callback.
let orderedStore = ram(pooled)
let orderedTx = detached(orderedStore)
orderedTx.patch([ana])
let orderingEvent = {
  kind: 'created' as const,
  entity: { eid: 'e-one' },
  name: 'mail',
}
test('the letter is marked tried before the transport sees it', async () => {
  let at: unknown[] = []
  orderedTx.remove([{ eid: 'e-one' }])
  orderedTx.patch([letter('e-one')])
  await sending({
    now: noon,
    sender: {
      send: async () => {
        at.push(((await orderedTx.get(['e-one']))[0].deliver as Comp).tried)
        return { id: 'r-1' }
      },
    },
  })(orderingEvent, orderedTx, async (rows) => {
    let written = await orderedTx.patch(rows)
    return orderedTx.get(written.map((entity) => entity.eid))
  })
  assertEquals(at, [noon()])
})
