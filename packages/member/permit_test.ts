// Referenced ownership grants a mark on an existing request, through the same
// graph apply boundary as ordinary row ownership and component floors.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import {
  type Actor,
  type Bundle,
  graph,
  signed,
  Stale,
  token,
} from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { completing } from '../kernel/completion.ts'
import { club } from './testing.ts'
import { memberKeywords } from './keywords.ts'
import { members } from './plugin.ts'
import { Denied } from './deny.ts'
import { Paced } from './pace.ts'

let declaration: VocabDoc = {
  $defs: {
    hero: { component: true, type: 'object', properties: {} },
    request: {
      component: true,
      type: 'object',
      floor: 'owner',
      permit: { completed: 'hero' },
      properties: {
        hero: { type: 'string', ref: 'hero', death: 'keep' },
        x: { type: 'number' },
      },
    },
    completed: { ...club.def('created') },
    tombstone: { component: true, type: 'object', properties: {} },
  },
}

let owner = { by: 'owner' }
let person = { by: 'kim', via: 'signed-browser' }
let guest = { via: 'guest-browser' }
let mark = (eid = 'request'): Bundle => ({ entity: { eid }, completed: {} })
let patch = (comp: string, value: Bundle[string], eid = 'request'): Bundle => ({
  entity: { eid },
  [comp]: value,
})

let fixture = async (floors = {}, kernelFirst = true, pace?: string) => {
  let doc = {
    ...declaration,
    $defs: {
      ...declaration.$defs,
      completed: { ...declaration.$defs!.completed, ...(pace ? { pace } : {}) },
    },
  }
  let vocab = loadVocab([...club.docs, doc], [memberKeywords])
  let storage = ram(vocab)
  let g = graph({ storage, vocab })
  await g.apply([
    {
      entity: { eid: 'app' },
      access: { mode: 'open' },
      app: { space: 'club' },
    },
    {
      entity: { eid: 'seat' },
      member: { space: 'club', person: 'owner', role: 'owner' },
    },
    { entity: { eid: 'hero' }, hero: {}, $actor: person },
    { entity: { eid: 'guest' }, hero: {}, $actor: guest },
    ...['hero', 'guest'].map((hero) => ({
      entity: { eid: hero == 'hero' ? 'request' : 'guest-request' },
      request: { hero, x: 1 },
      $actor: owner,
    })),
  ], { now: '2026-10-01T00:00:00Z' })
  let completion = { name: 'completion', hooks: { precondition: completing } }
  let guard = members({ app: 'app', space: 'club', vocab, floors })
  for (let plugin of kernelFirst ? [completion, guard] : [guard, completion]) {
    g.use(plugin)
  }
  return {
    g,
    read: async (eid = 'request') => (await g.read(`.entity.eid=${eid}`))[0],
    apply: (actor: Actor | null, ...b: Bundle[]) =>
      g.apply(signed(b, actor), { now: '2026-10-02T00:00:00Z' }),
  }
}

test('a referenced hero owner completes once, in either hook order', async () => {
  for (let kernelFirst of [true, false]) {
    let f = await fixture({}, kernelFirst)
    await f.apply(person, mark())
    let done = (await f.read()).completed
    assertEquals(done, {
      at: '2026-10-02T00:00:00Z',
      by: person.by,
      via: person.via,
    })
    await f.g.apply(signed([mark()], { ...person, via: 'another-browser' }), {
      now: '2026-10-03T00:00:00Z',
    })
    assertEquals((await f.read()).completed, done)
    assertEquals((await f.read()).request, { hero: 'hero', x: 1 })
  }
})

test('only an unbylined hero belongs to its browser', async () => {
  let f = await fixture()
  await f.apply(guest, mark('guest-request'))
  assertEquals((await f.read('guest-request')).completed, {
    at: '2026-10-02T00:00:00Z',
    by: null,
    via: guest.via,
  })
  for (
    let actor of [null, { by: 'stranger' }, { via: 'other-browser' }, {
      via: person.via,
    }]
  ) {
    await assertRejects(async () => await f.apply(actor, mark()), Denied)
  }
  assertEquals((await f.read()).completed, undefined)
})

test('a mark never grants request edits, deletion, rebinding or creation', async () => {
  let f = await fixture()
  let before = await f.read()
  let changes: Bundle[][] = [
    [{ ...mark(), request: { x: 2 } }],
    [mark(), patch('request', { hero: 'guest' })],
    [patch('request', { hero: 'guest' }), mark()],
    [mark(), patch('request', null)],
    [{ ...mark(), $delete: true }],
    [mark(), { entity: { eid: 'request' }, $delete: true }],
    [mark(), patch('pick', { title: 'Changed' })],
    [{ ...mark('new'), request: { hero: 'hero', x: 2 } }],
    [patch('request', { hero: 'hero', x: 2 }, 'new'), mark('new')],
  ]
  for (let batch of changes) {
    await assertRejects(async () => await f.apply(person, ...batch), Denied)
    assertEquals(await f.read(), before)
    assertEquals(await f.read('new'), undefined)
  }
  await f.apply(person, mark())
  await f.apply(owner, patch('completed', null))
  assertEquals((await f.read()).completed, undefined)
})

test('a referenced owner may remove a mark without editing the request', async () => {
  let f = await fixture()
  for (
    let [actor, eid] of [[person, 'request'], [guest, 'guest-request']] as const
  ) {
    await f.apply(actor, mark(eid))
    let before = await f.read(eid)
    await assertRejects(
      async () =>
        await f.apply({ by: 'stranger' }, patch('completed', null, eid)),
      Denied,
    )
    await assertRejects(
      async () =>
        await f.apply(
          actor,
          patch('completed', null, eid),
          patch('request', { x: 2 }, eid),
        ),
      Denied,
    )
    await assertRejects(async () =>
      await f.g.apply(
        signed([
          patch('completed', { via: 'forged' }, eid),
        ], actor),
        { trusted: true, stamp: false },
      ), Denied)
    assertEquals(await f.read(eid), before)
    await f.apply(actor, patch('completed', null, eid))
    await f.apply(actor, patch('completed', null, eid))
    assertEquals((await f.read(eid)).completed, undefined)
    assertEquals((await f.read(eid)).request, before.request)
  }
})

test('permission requires a live stored target and obeys mode and mark floors', async () => {
  let f = await fixture()
  await f.apply(owner, patch('request', { hero: 'missing' }))
  await assertRejects(async () => await f.apply(person, mark()), Denied)
  await f.apply(owner, patch('request', { hero: 'hero' }))
  await f.apply(person, { entity: { eid: 'hero' }, $delete: true })
  await assertRejects(async () => await f.apply(person, mark()), Denied)
  assertEquals((await f.read()).completed, undefined)

  f = await fixture({ completed: 'owner' })
  await assertRejects(async () => await f.apply(person, mark()), Denied)
  await f.apply(owner, mark())
  f = await fixture()
  await f.apply(owner, patch('access', { mode: 'public' }, 'app'))
  await assertRejects(async () => await f.apply(person, mark()), Denied)
})

test('a completion does not accept client stamps or forged actors', async () => {
  let f = await fixture()
  await assertRejects(async () =>
    await f.apply({ by: 'stranger' }, {
      ...mark(),
      $actor: person,
    }), Denied)
  await f.apply(person, {
    ...mark(),
    completed: { by: 'stranger', via: 'forged', at: '2020-01-01T00:00:00Z' },
  })
  assertEquals((await f.read()).completed, undefined)
  await f.apply(person, mark())
  assertEquals((await f.read()).completed, {
    at: '2026-10-02T00:00:00Z',
    by: person.by,
    via: person.via,
  })
})

test('companion permission follows the target current ownership', async () => {
  let f = await fixture()
  await f.g.apply(
    signed([{
      entity: { eid: 'hero' },
      created: { by: 'new-owner', via: 'new-browser' },
    }], owner),
    { trusted: true, stamp: false },
  )
  await assertRejects(async () => await f.apply(person, mark()), Denied)
  await f.apply({ by: 'new-owner', via: 'new-browser' }, mark())
  assertEquals((await f.read()).completed, {
    at: '2026-10-02T00:00:00Z',
    by: 'new-owner',
    via: 'new-browser',
  })
})

test('a permitted mark retains conditional write checks and pacing', async () => {
  let f = await fixture()
  await f.apply(owner, patch('request', { x: 2 }))
  await assertRejects(async () =>
    await f.apply(person, {
      ...mark(),
      $was: { request: { x: token(1) } },
    }), Stale)
  assertEquals((await f.read()).completed, undefined)

  f = await fixture({}, true, '1h')
  await f.g.apply(
    signed([patch('_pace', {
      writes: [{ comp: 'completed', via: person.via, at: Date.now() }],
    })], owner),
    { trusted: true, stamp: false },
  )
  await assertRejects(async () => await f.apply(person, mark()), Paced)
  assertEquals((await f.read()).completed, undefined)
})
