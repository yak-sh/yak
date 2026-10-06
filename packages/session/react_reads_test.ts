// The provider still receives exact history; status after it returns needs no old prose.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, graph, identityEid } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { modelDoc, type Request } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { contextDoc } from '@yaks/context'
import { effectDoc } from '@yaks/effects'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { react, transcript } from './react.ts'
import { sessions } from './plugin.ts'

for (let fork of [false, true]) {
  test(`completion status sees old concurrent edits without rereading prose (fork: ${fork})`, async () => {
    let vocab = loadVocab([
      sessionDoc,
      modelDoc,
      toolsDoc,
      contextDoc,
      effectDoc,
      kernelDoc,
      archetypeDoc,
    ], [kernelKeywords])
    let d = mem(), s = storage(d, vocab, { derived: sessionDerived(vocab) })
    let g = graph({ vocab, storage: s, plugins: [sessions()] })
    let m = identityEid('model', ['fake'])
    let old: Bundle[] = [
      { entity: { eid: m }, model: { name: 'fake' } },
      { entity: { eid: 'parent' }, session: {} },
      {
        entity: { eid: 'old' },
        entry: { session: 'parent', seq: 1 },
        content: { body: 'old exact text' },
      },
      {
        entity: { eid: 'anchor' },
        entry: { session: 'parent', seq: 2 },
        content: { body: 'anchor exact text' },
      },
      ...fork
        ? [{ entity: { eid: 'child' }, session: {}, fork: { from: 'anchor' } }]
        : [],
      {
        entity: { eid: 'input' },
        entry: { session: fork ? 'child' : 'parent', seq: 3 },
        using: { model: m, window: 16 },
        content: { body: 'now' },
      },
    ]
    await g.apply(old)
    let after = false, bodyReads = 0, read = g.read.bind(g)
    g.read = (q, opts) => {
      if (
        after && typeof q == 'string' && q.includes('.entry.session=') &&
        q.includes('&*')
      ) bodyReads++
      return read(q, opts)
    }
    let asked: Request[] = []
    try {
      let step = await react(g, fork ? 'child' : 'parent', {
        tools: [],
        model: async (request) => {
          asked.push(request)
          // A different writer changes even a fork ancestor during the await.
          await s.tx((tx) =>
            tx.patch([{ entity: { eid: 'old' }, content: null, stop: {} }])
          )
          after = true
          return {
            id: 'r',
            model: 'fake',
            items: [{ kind: 'assistant', text: 'done' }],
          }
        },
      })
      after = false
      assertEquals(step.status, 'settled')
      assertEquals(asked[0].items, [
        { kind: 'user', text: 'old exact text' },
        { kind: 'user', text: 'anchor exact text' },
        { kind: 'user', text: 'now' },
      ])
      assertEquals((await transcript(g, fork ? 'child' : 'parent'))[0].stop, {})
      assert(
        bodyReads == 0,
        `completion reread ${bodyReads} whole transcript reads`,
      )
    } finally {
      g.read = read
    }
  })
}

for (let fork of [false, true]) {
  test(`finite model window reads selected prose, retaining exact inherited lines (fork: ${fork})`, async () => {
    let vocab = loadVocab([
      sessionDoc,
      modelDoc,
      toolsDoc,
      contextDoc,
      effectDoc,
      kernelDoc,
      archetypeDoc,
    ], [kernelKeywords])
    let d = mem(), s = storage(d, vocab, { derived: sessionDerived(vocab) })
    let g = graph({ vocab, storage: s, plugins: [sessions()] })
    let m = identityEid('model', ['fake'])
    await g.apply([
      { entity: { eid: m }, model: { name: 'fake' } },
      { entity: { eid: 'parent' }, session: {} },
      ...Array.from({ length: 200 }, (_, i): Bundle => ({
        entity: { eid: 'e' + i },
        entry: { session: 'parent', seq: i + 1 },
        content: { body: 'exact line ' + i },
      })),
      ...fork
        ? [{ entity: { eid: 'child' }, session: {}, fork: { from: 'e199' } }]
        : [],
      {
        entity: { eid: 'input' },
        entry: { session: fork ? 'child' : 'parent', seq: 201 },
        using: { model: m, window: 16 },
        content: { body: 'now' },
      },
    ])
    let bodyRows = 0, read = g.read.bind(g), get = g.get.bind(g)
    g.read = async (q, opts) => {
      let rows = await read(q, opts)
      bodyRows += rows.filter((b) =>
        b.content && typeof b.content == 'object' &&
        Object.hasOwn(b.content, 'body')
      ).length
      return rows
    }
    g.get = async (ids, comps, opts) => {
      let rows = await get(ids, comps, opts)
      bodyRows += rows.filter((b) =>
        b.content && typeof b.content == 'object' &&
        Object.hasOwn(b.content, 'body')
      ).length
      return rows
    }
    let asked: Request[] = []
    let step = await react(g, fork ? 'child' : 'parent', {
      tools: [],
      model: (request) => {
        asked.push(request)
        return Promise.resolve({
          id: 'reply',
          model: 'fake',
          items: [{ kind: 'assistant', text: 'done' }],
        })
      },
    })
    assertEquals(step.status, 'settled')
    assertEquals(asked[0].items, [
      ...Array.from(
        { length: 15 },
        (_, i) => ({ kind: 'user' as const, text: 'exact line ' + (185 + i) }),
      ),
      { kind: 'user', text: 'now' },
    ])
    assert(bodyRows <= 16, `finite window loaded ${bodyRows} content rows`)
  })
}

test('the runner inspects finite-window status without loading old transcript prose', async () => {
  let vocab = loadVocab([
    sessionDoc,
    modelDoc,
    toolsDoc,
    contextDoc,
    effectDoc,
    kernelDoc,
    archetypeDoc,
  ], [kernelKeywords])
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
  let g = graph({ vocab, storage: s, plugins: [sessions()] }),
    m = identityEid('model', ['fake'])
  await g.apply([
    { entity: { eid: m }, model: { name: 'fake' } },
    { entity: { eid: 'runner' }, session: {} },
    { entity: { eid: 'worker' } },
    ...Array.from(
      { length: 200 },
      (_, i): Bundle => ({
        entity: { eid: 'r' + i },
        entry: { session: 'runner', seq: i + 1 },
        content: { body: 'old line ' + i },
      }),
    ),
    {
      entity: { eid: 'input' },
      entry: { session: 'runner', seq: 201 },
      content: { body: 'now' },
      using: { model: m, window: 16 },
    },
  ])
  let bodies = 0, read = g.read.bind(g)
  g.read = async (q, opts) => {
    let rows = await read(q, opts)
    if (
      typeof q == 'string' && q.includes('.entry.session=runner') &&
      q.includes('&*')
    ) bodies += rows.filter((b) => b.content).length
    return rows
  }
  let { settle } = await import('./run.ts')
  await settle(g, 'runner', {
    holder: 'worker',
    tools: [],
    model: () =>
      Promise.resolve({
        id: 'reply',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'done' }],
      }),
  })
  assertEquals(bodies, 0)
})
