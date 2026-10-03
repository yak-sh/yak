// Admission runs ordinary checks against temporary rows. These tests keep the
// storage boundary visible and exercise both its rehearsal and rollback paths.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { graph } from './graph.ts'
import { Refused } from './admit.ts'
import { admitSchema } from './admit_schema.ts'
import { books, memory, slow } from './testing.ts'
import type { Plugin } from './plugin.ts'
import type { Bundle } from './bundle.ts'
import { after } from '@yaks/fp'
import { ram } from '@yaks/ram'
import { Stale, token } from './guard.ts'

for (let certified of [false, true]) {
  for (let rewrite of [false, true]) {
    test(`admission returns checked peer values from ${rewrite ? 'hooks' : 'rules'} (${certified})`, async () => {
      let vocab = loadVocab({
        $defs: {
          position: {
            component: true,
            sync: 'peers',
            type: 'object',
            properties: {
              x: { type: 'number', maximum: 100, validate: true },
              label: { type: 'string' },
            },
          },
        },
      })
      let value = { x: 100, label: 'bounded' }
      let policy: Plugin = {
        name: 'bound',
        ...(certified ? { admission: () => true } : {}),
        ...(rewrite
          ? {
            hooks: {
              precondition: (b) =>
                b.map((row) => ({ ...row, position: value })),
            },
          }
          : {
            rules: [{
              name: 'bound',
              phase: 'precondition',
              match: '*position',
              produce: { position: value },
            }],
          }),
      }
      let g = graph({
        storage: memory(),
        vocab,
        plugins: [policy, admitSchema(vocab)],
      })
      let input: Bundle[] = [{
        entity: { eid: 'p1' },
        position: { x: rewrite ? 200 : 50 },
      }]
      let ordinary = await g.apply(input, { check: true })
      let checked = await g.admit(input)
      assertEquals(ordinary[0].position, value)
      assertEquals(checked[0].position, ordinary[0].position)
      assertEquals(await g.get(['p1']), [])
    })
  }
}

for (let async of [false, true]) {
  test(`admission rehearses ordered writes without calling storage's writer (${async})`, async () => {
    let base = memory(), writes = 0, journal = 0, effect = 0
    let plugin: Plugin = {
      name: 'limit',
      admission: () => true,
      beforeWrite: () => (bundles, tx) =>
        after(tx.get(['b1']), (held) => {
          if (held[0]?.book && (held[0].book as { pages: number }).pages == 2) {
            throw new Refused('already two')
          }
          return bundles
        }),
      hooks: {
        journal: (b) => {
          journal++
          return b
        },
        effect: (b) => {
          effect++
          return b
        },
      },
    }
    let storage = {
      ...base,
      tx: <T>(body: Parameters<typeof base.tx<T>>[0]) =>
        base.tx((tx) =>
          body({
            ...tx,
            patch: (b) => {
              writes++
              return tx.patch(b)
            },
          })
        ),
    }
    let g = graph({
      storage: async ? slow(storage) : storage,
      vocab: books,
      plugins: [plugin],
    })
    let first: Bundle = { entity: { eid: 'b1' }, book: { pages: 2 } }
    assertEquals((await g.admit([first]))[0].book, first.book)
    assertEquals([writes, journal, effect], [0, 0, 0])
    assertEquals(await g.get(['b1']), [])
    await assertRejects(
      async () =>
        await g.admit([first, { entity: { eid: 'b1' }, book: { pages: 3 } }]),
      Refused,
      'already two',
    )
    assertEquals(writes, 0)
    await g.apply([first])
    assertEquals([writes > 0, journal, effect], [true, 1, 1])
  })
}

test('legacy checks fall back to rollback and return checked patches', async () => {
  let audits: (boolean | undefined)[] = []
  let g = graph({
    storage: memory(),
    vocab: books,
    plugins: [{
      name: 'legacy',
      hooks: {
        commit: (b) => {
          if ((b[0].book as { pages: number })?.pages == 9) {
            throw new Refused('nine')
          }
          return b
        },
        audit: (b, _tx, _err, ctx) => {
          audits.push(ctx?.admission)
          return b
        },
      },
    }],
  })
  let input: Bundle = { entity: { eid: 'b1' }, doc: { title: 42 } }
  let [checked] = await g.admit([input])
  assertEquals(checked.entity.eid, 'b1')
  assertEquals(checked.doc, { title: '42' })
  assertEquals(await g.get(['b1']), [])
  await assertRejects(
    async () => await g.admit([{ entity: { eid: 'b1' }, book: { pages: 9 } }]),
    Refused,
    'nine',
  )
  assertEquals(audits.at(-1), true)
  assertEquals(await g.get(['b1']), [])
})

test('a later rewrite can require a journal check through ordinary rollback', async () => {
  let g = graph({
    storage: memory(),
    vocab: books,
    plugins: [{
      name: 'rewrite',
      admission: () => true,
      hooks: {
        mutate: (b) => b.map((row) => ({ ...row, doc: { title: 'added' } })),
      },
    }, {
      name: 'conditional',
      admission: (b) => b.every((row) => !row.doc),
      hooks: {
        journal: (b) => {
          if (b.some((row) => row.doc)) throw new Refused('journal refused')
          return b
        },
      },
    }],
  })
  let input: Bundle[] = [{ entity: { eid: 'b1' }, book: { pages: 2 } }]
  await assertRejects(
    async () => await g.admit(input),
    Refused,
    'journal refused',
  )
  await assertRejects(
    async () => await g.apply(input, { check: true }),
    Refused,
    'journal refused',
  )
  assertEquals(await g.get(['b1']), [])
})

for (let async of [false, true]) {
  test(`adapter queries after temporary writes preserve normalization when falling back (${async})`, async () => {
    let storage = ram(books), normalized = 0, minted: string[] = []
    let g = graph({
      storage: async ? slow(storage) : storage,
      vocab: books,
      plugins: [{
        name: 'query',
        admission: () => true,
        hooks: {
          normalize: (b) => {
            normalized++
            return b
          },
          mint: (b) => {
            minted.push(b[0].entity.eid)
            return b
          },
          mutate: (b, tx) =>
            after(tx.read('.book.pages=2'), (found) => {
              if (found.length != 1) {
                throw new Refused('missing preceding write')
              }
              return b
            }),
        },
      }],
    })
    let [out] = await g.admit([{ entity: { eid: '$one' }, book: { pages: 2 } }])
    assertEquals(normalized, 1)
    assertEquals(minted, [out.entity.eid])
    assertEquals(out.book, { pages: 2 })
    assertEquals(await g.get([out.entity.eid]), [])
  })
}

test('peer overlays supply the complete checked schema value', async () => {
  let vocab = loadVocab({
    $defs: {
      point: {
        component: true,
        sync: 'peers',
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', minimum: 0, validate: true },
          y: { type: 'number', validate: true },
        },
      },
      facing: {
        component: true,
        sync: 'peers',
        type: 'object',
        properties: { angle: { type: 'number' } },
      },
    },
  })
  let g = graph({ storage: memory(), vocab, plugins: [admitSchema(vocab)] })
  let patch: Bundle = { entity: { eid: 'p1' }, point: { x: 2 } }
  let overlay: Bundle[] = [
    { entity: { eid: 'p1' }, point: { x: 1, y: 3 } },
    { entity: { eid: 'p1' }, facing: { angle: 4 } },
  ]
  assertEquals(await g.admit([patch], { overlay }), [{
    entity: { eid: 'p1' },
    point: { x: 2, y: 3 },
  }])
  await assertRejects(
    async () =>
      await g.admit([{ entity: { eid: 'p1' }, point: { x: -1 } }], { overlay }),
    Refused,
  )
  await assertRejects(async () => await g.admit([patch]), Refused)
  assertEquals(await g.get(['p1']), [])
})

test('preconditions see held peer values on stored entities and committed guards', async () => {
  let vocab = loadVocab({
    $defs: {
      owner: {
        component: true,
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      presence: {
        component: true,
        sync: 'peers',
        type: 'object',
        properties: { x: { type: 'number' } },
      },
    },
  })
  let g = graph({
    storage: memory(),
    vocab,
    plugins: [{
      name: 'owner',
      admission: () => true,
      hooks: {
        precondition: (b, tx) =>
          after(tx.get(b.map((r) => r.entity.eid)), (held) => {
            if (held.some((r) => r.owner && r.presence)) {
              throw new Refused('owned value')
            }
            return b
          }),
      },
    }],
  })
  await g.apply([{ entity: { eid: 'stored' }, owner: { name: 'Ada' } }])
  await assertRejects(
    async () =>
      await g.admit([{
        entity: { eid: 'stored' },
        presence: { x: 2 },
        $was: { presence: { x: token(1) } },
      }], { overlay: [{ entity: { eid: 'stored' }, presence: { x: 1 } }] }),
    Stale,
  )
  await assertRejects(
    async () =>
      await g.admit([{ entity: { eid: 'stored' }, presence: null }], {
        overlay: [{ entity: { eid: 'stored' }, presence: { x: 1 } }],
      }),
    Refused,
    'owned value',
  )
  let patch: Bundle = { entity: { eid: 'new' }, presence: { x: 2 } }
  assertEquals(
    await g.admit([patch], {
      overlay: [{ entity: { eid: 'new' }, presence: { x: 1 } }],
    }),
    [patch],
  )
  assertEquals((await g.get(['stored']))[0].presence, undefined)
})

test('a warmed admission runs newly registered and changing checks', async () => {
  let g = graph({ storage: memory(), vocab: books })
  let input: Bundle[] = [{ entity: { eid: 'b1' }, book: { pages: 1 } }]
  await g.admit(input)
  let allowed = true
  g.use({
    name: 'permission',
    admission: () => true,
    hooks: {
      precondition: (b) => {
        if (!allowed) throw new Refused('permission moved')
        return b
      },
    },
  })
  assertEquals((await g.admit(input))[0].book, { pages: 1 })
  allowed = false
  await assertRejects(
    async () => await g.admit(input),
    Refused,
    'permission moved',
  )
  assertEquals(await g.get(['b1']), [])
})

test('a warmed write uses rules installed after its first apply', async () => {
  let vocab = loadVocab({
    $defs: {
      book: { component: true, properties: { pages: { type: 'number' } } },
      doc: { component: true, properties: { title: { type: 'string' } } },
    },
  })
  let g = graph({ storage: ram(vocab), vocab })
  let input: Bundle[] = [{ entity: { eid: 'b1' }, book: { pages: 1 } }]
  await g.apply(input)
  g.use({
    name: 'titles',
    declared: [{ name: 'title', match: '.book !doc +doc.title=Read' }],
  })
  assertEquals((await g.apply(input))[0].doc, { title: 'Read' })
})
