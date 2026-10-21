// Every writer meets reference admission, including stamps and rule outputs.
import { equal, ok, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import { Refused } from './errors.ts'
import type { Comp } from './bundle.ts'
import type { Plugin } from './plugin.ts'

let target = '00000000-0000-4000-8000-000000000001'
let words = loadVocab({
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    trigger: { component: true },
    link: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity' } },
    },
    created: {
      component: true,
      properties: {
        by: { type: 'string', ref: 'entity', stamped: true },
        via: { type: 'string', ref: 'entity', stamped: true },
        at: { type: 'string', stamped: true },
      },
    },
  },
})
let make = () => graph({ vocab: words, storage: ram(words) })

for (
  let source of ['actor', 'declared', 'rule', 'hook', 'hook-actor'] as const
) {
  test(`${source} resolves a title at the shared write door`, async () => {
    let g = make()
    await g.apply([{ entity: { eid: target }, doc: { title: 'Ada' } }])
    let plugin: Plugin = { name: source }
    let journalActor: unknown
    if (source == 'hook-actor') {
      plugin.hooks = {
        normalize: (bs) =>
          bs.map((b) => ({ ...b, $actor: { by: 'Ada', via: 'Ada' } })),
        journal: (bs) => {
          journalActor = bs[0].$actor
          return bs
        },
      }
    }
    if (source == 'declared') {
      plugin.declared = [{
        name: 'link',
        match: '$x .trigger !link; $x +link.to=Ada',
      }]
    }
    if (source == 'rule') {
      plugin.rules = [{
        phase: 'stamp',
        match: '.trigger +link',
        produce: { link: { to: 'Ada' } },
      }]
    }
    if (source == 'hook') {
      plugin.hooks = {
        journal: (b, tx) => {
          return Promise.resolve(
            tx.patch([{ entity: { eid: 'record' }, link: { to: 'Ada' } }]),
          ).then(() => b)
        },
      }
    }
    g.use(plugin)
    let out = await g.apply([{
      entity: { eid: 'record' },
      trigger: {},
      ...source == 'actor' ? { $actor: { by: 'Ada', via: 'Ada' } } : {},
    }])
    let row = (await g.get(['record']))[0]
    if (source == 'actor' || source == 'hook-actor') {
      equal((row.created as Comp).by, target)
      equal((row.created as Comp).via, target)
      equal((out[0].created as Comp).by, target)
      if (source == 'hook-actor') {
        equal(journalActor, {
          by: target,
          via: target,
        })
      }
    } else equal((row.link as Comp).to, target)
    equal(await g.get(['Ada']), [])
  })
}

for (
  let value of [
    'server',
    'yak',
    '',
    'a643388444',
    'https://github.com/yaksh/yaks',
  ]
) {
  test(`unresolved writer reference ${JSON.stringify(value)} rolls back`, async () => {
    let g = make()
    g.use({
      name: 'writer',
      rules: [{
        phase: 'stamp',
        match: '.trigger +link',
        produce: { link: { to: value } },
      }],
    })
    await assertRejects(
      async () => await g.apply([{ entity: { eid: 'record' }, trigger: {} }]),
      Refused,
    )
    equal(await g.get(['record', value]), [])
  })
}

test('actor aliases resolve before stamps and a missing actor is refused', async () => {
  let g = make()
  let out = await g.apply([{
    entity: { eid: '$actor' },
    doc: { title: 'Writer' },
    $actor: { by: '$actor' },
  }])
  equal((out[0].created as Comp).by, out[0].entity.eid)
  await assertRejects(
    async () =>
      await g.apply([{
        entity: { eid: 'record' },
        trigger: {},
        $actor: { by: 'server' },
      }]),
    Refused,
  )
  ok(!(await g.get(['record'])).length)
})

// A browser's door names the person and, when it knows none, no instrument.
let unaided = make()
await unaided.apply([{ entity: { eid: target }, doc: { title: 'Ada' } }])

test('an actor with no instrument stamps who wrote it', async () => {
  let [out] = await unaided.apply([{
    entity: { eid: 'note' },
    doc: { title: 'said' },
    $actor: { by: target, via: undefined },
  }])
  equal((out.created as Comp).by, target)
})

test('stamps follow numeric timestamp declarations', async () => {
  let vocab = loadVocab({
    $defs: {
      item: { component: true },
      created: {
        component: true,
        properties: { at: { type: 'number', stamped: true } },
      },
      updated: {
        component: true,
        properties: { at: { type: 'number', stamped: true } },
      },
    },
  })
  let g = graph({ vocab, storage: ram(vocab) })
  let now = '2026-10-12T12:00:00.000Z'
  let [created] = await g.apply([{ entity: { eid: 'item' }, item: {} }], {
    now,
  })
  equal((created.created as Comp).at, Date.parse(now))
  let [updated] = await g.apply([{ entity: { eid: 'item' }, item: {} }], {
    now,
  })
  equal((updated.updated as Comp).at, Date.parse(now))
})
