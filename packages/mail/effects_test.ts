// The outbound half as a host composes it: a transport nobody can build is a
// graph whose letters wait, never a host that will not come up — and the first
// process that can send sends them, once.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effectDoc, effects as registry, type Handlers } from '@yaks/effects'
import { docs } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { effects, post } from './effects.ts'
import type { Transport } from './options.ts'
import { mailbox } from './plugin.ts'
import { club, noon } from './testing.ts'
import { type Sender, sending } from './send.ts'
import { stash } from './stash.ts'

let quietly = async <T>(body: () => T): Promise<[Awaited<T>, unknown[]]> => {
  let warned: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => warned.push(said[1])
  try {
    return [await body(), warned]
  } finally {
    console.warn = warn
  }
}

let unarmed = { via: 'cloudflare', account: 'a' } as Transport

// The club with a pool, so what one process writes another can run.
let pooled = loadVocab([...club.docs, effectDoc])

// A process over `storage`, working the pool with the code it was given.
let proc = async (storage: Storage, handlers: Handlers) => {
  let fx = registry(pooled, { write: (b) => g.apply(b, { trusted: true }) })
  fx.handle(handlers)
  let g = graph({
    storage,
    vocab: pooled,
    plugins: [fx, docs(), mailbox({ domain: 'books.example' })],
  })
  await fx.work(g)
  return Object.assign(g, { fx, storage })
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
  ((await g.read(`.eid=${eid}`)) as Bundle[])[0]

Deno.test('a transport that is named and complete sends', async () => {
  let [code, warned] = await quietly(() =>
    effects(null, { sender: { via: 'stash' } })
  )
  let g = await rig(code)
  await g.apply([ana, letter('e-one')])
  await g.fx.idle()
  assert((await read(g, 'e-one')).delivered)
  assertEquals(warned, [])
})

Deno.test('no sender named is no code, and nothing said about it', async () => {
  let [code, warned] = await quietly(() => effects(null, {}))
  assertEquals(code, {})
  assertEquals(warned, [])
})

Deno.test('credentials that have not arrived say nothing until a letter is owed', async () => {
  let said = post(unarmed)
  assertEquals(said.sender, undefined)
  assert(said.waiting?.startsWith('waiting for credentials'), `${said.waiting}`)
  let [code, warned] = await quietly(() => effects(null, { sender: unarmed }))
  assertEquals(warned, [])
  let g = await rig(code)
  let [, arrived] = await quietly(async () => {
    await g.apply([ana, {
      entity: { eid: 'e-in' },
      mail: { from: 'bea@out.example', to: 'hello@books.example' },
    }])
    await g.fx.idle()
  })
  assertEquals(arrived, [])
  let [, owed] = await quietly(async () => {
    await g.apply([letter('e-one')])
    await g.apply([letter('e-two')])
    await g.fx.idle()
  })
  assertEquals(owed.length, 1)
  assert(String(owed[0]).includes('waiting for credentials'), `${owed[0]}`)
  let kept = await read(g, 'e-one')
  assertEquals(kept.deliver, { to: 'p-ana' })
  assertEquals(kept.delivered, undefined)
})

Deno.test('a letter written with no sender goes with the first process that has one, once', async () => {
  let [code] = await quietly(() => effects(null, { sender: unarmed }))
  let g = await rig(code)
  await quietly(async () => {
    await g.apply([ana, letter('e-one')])
    await g.fx.idle()
  })
  let box = stash()
  await sweep(g, box)
  assertEquals(box.sent.map((m) => m.subject), ['Potluck Friday'])
  let sent = await read(g, 'e-one')
  assertEquals(sent.delivered, { at: noon() })
  assertEquals((sent.mail as Comp).message_id, 'stash-1')
  assertEquals((sent.deliver as Comp).tried, noon())
  await sweep(g, box)
  assertEquals(box.sent.length, 1)
})

Deno.test('a letter handed over and never settled is not handed over again', async () => {
  let g = await rig({})
  await g.apply([ana])
  await g.apply([letter('e-lost', {
    entity: { eid: 'e-lost' },
    deliver: { tried: noon() },
  })], { trusted: true })
  await g.apply([letter('e-sent'), {
    entity: { eid: 'e-sent' },
    delivered: { at: noon() },
  }], { trusted: true })
  let box = stash()
  await sweep(g, box)
  assertEquals(box.sent, [])
})

Deno.test('the letter is marked tried before the transport sees it', async () => {
  let at: unknown[] = []
  let g = await rig({
    mail_post: sending({
      now: noon,
      sender: {
        send: async () => {
          at.push(((await read(g, 'e-one')).deliver as Comp).tried)
          return { id: 'r-1' }
        },
      },
    }),
  })
  await g.apply([ana, letter('e-one')])
  await g.fx.idle()
  assertEquals(at, [noon()])
})
