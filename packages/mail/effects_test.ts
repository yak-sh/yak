// The outbound half as a host composes it: a transport nobody can build is a
// graph whose letters wait, never a host that will not come up — and the first
// process that can send sends them, once.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, detached, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effects as registry, type Watch } from '@yaks/effects'
import { docs } from '@yaks/doc'
import { effects, post } from './effects.ts'
import type { Transport } from './options.ts'
import { mailbox } from './plugin.ts'
import { club, noon } from './harness.ts'
import { PENDING, type Sender, sending } from './send.ts'
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

// A club whose mail watch is whatever the test registers — the process that
// wrote the letter — over storage a second registry can sweep afterwards.
let rig = (watches: Watch[]) => {
  let fx = registry(club, { write: (b) => g.apply(b, { trusted: true }) })
  for (let { comp, ...w } of watches) fx.on(comp, w)
  let storage = ram(club)
  let g = graph({
    storage,
    vocab: club,
    plugins: [fx, docs(), mailbox({ domain: 'books.example' })],
  })
  return Object.assign(g, { tx: detached(storage) })
}

// Another process opening the same graph with a sender: its registry, and the
// start-up pass a host makes over the letters still owed (@yaks/cli
// `unfinished`).
let sweep = (g: ReturnType<typeof rig>, sender: Sender) => {
  let fx = registry(club, { write: (b) => g.apply(b, { trusted: true }) })
  fx.created('mail', sending({ sender, now: noon }), {
    sweep: { pending: PENDING },
  })
  return fx.relay(
    async (comp, pending) =>
      ((await g.read(pending)) as Bundle[]).map((b) => ({
        eid: b.entity.eid,
        ...b[comp] as Comp,
      })),
    g.tx,
  )
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

let read = async (g: ReturnType<typeof rig>, eid: string) =>
  ((await g.read(`.eid=${eid}`)) as Bundle[])[0]

Deno.test('a transport that is named and complete is the one watch', async () => {
  let [watches] = await quietly(() =>
    effects(null, { sender: { via: 'stash' } })
  )
  assertEquals(watches.map((w) => w.comp), ['mail'])
  assertEquals(watches[0].sweep, { pending: PENDING })
})

Deno.test('no sender named is no watch, and nothing said about it', async () => {
  let [watches, warned] = await quietly(() => effects(null, {}))
  assertEquals(watches, [])
  assertEquals(warned, [])
})

Deno.test('credentials that have not arrived say nothing until a letter is owed', async () => {
  let said = post(unarmed)
  assertEquals(said.sender, undefined)
  assert(said.waiting?.startsWith('waiting for credentials'), `${said.waiting}`)
  let [watches, warned] = await quietly(() =>
    effects(null, { sender: unarmed })
  )
  assertEquals(watches.map((w) => w.sweep), [{ pending: PENDING }])
  assertEquals(warned, [])
  let g = rig(watches)
  let [, arrived] = await quietly(() =>
    g.apply([ana, {
      entity: { eid: 'e-in' },
      mail: { from: 'bea@out.example', to: 'hello@books.example' },
    }])
  )
  assertEquals(arrived, [])
  let [, owed] = await quietly(async () => {
    await g.apply([letter('e-one')])
    await g.apply([letter('e-two')])
  })
  assertEquals(owed.length, 1)
  assert(String(owed[0]).includes('waiting for credentials'), `${owed[0]}`)
  let kept = await read(g, 'e-one')
  assertEquals(kept.deliver, { to: 'p-ana' })
  assertEquals(kept.delivered, undefined)
})

Deno.test('a letter written with no sender goes with the first process that has one, once', async () => {
  let [watches] = await quietly(() => effects(null, { sender: unarmed }))
  let g = rig(watches)
  await quietly(() => g.apply([ana, letter('e-one')]))
  let box = stash()
  await sweep(g, box)
  assertEquals(box.sent.map((m) => m.subject), ['Potluck Friday'])
  let sent = await read(g, 'e-one')
  assertEquals(sent.delivered, { at: noon(), via: 'stash-1' })
  assertEquals((sent.deliver as Comp).tried, noon())
  await sweep(g, box)
  assertEquals(box.sent.length, 1)
})

Deno.test('a letter handed over and never settled is not handed over again', async () => {
  let g = rig([])
  await g.apply([ana])
  await g.apply([letter('e-lost', {
    entity: { eid: 'e-lost' },
    deliver: { tried: noon() },
  })], { trusted: true })
  await g.apply([letter('e-sent'), {
    entity: { eid: 'e-sent' },
    delivered: { at: noon(), via: 'x' },
  }], { trusted: true })
  let box = stash()
  await sweep(g, box)
  assertEquals(box.sent, [])
})

Deno.test('the letter is marked tried before the transport sees it', async () => {
  let at: unknown[] = []
  let g = rig([{
    comp: 'mail',
    created: sending({
      now: noon,
      sender: {
        send: async () => {
          at.push(((await read(g, 'e-one')).deliver as Comp).tried)
          return { id: 'r-1' }
        },
      },
    }),
  }])
  await g.apply([ana, letter('e-one')])
  assertEquals(at, [noon()])
})
