import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Graph, graph, Stale, token } from '@yaks/graph'
import { runs } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from './comp.ts'
import { docs } from './plugin.ts'

let vocab = loadVocab([docDoc, {
  $defs: {
    design: { component: true, type: 'object', properties: {} },
    persona: { component: true, type: 'object', properties: {} },
  },
}])
let tools = runs()
let fresh = (kind = 'doc', body: string | null = 'first'): Graph => {
  let storage = ram(vocab)
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'draft' },
      ...(kind == 'doc' ? {} : { [kind]: {} }),
      doc: { title: 'draft', ...(body == null ? {} : { body }) },
    }])
  )
  return graph({ storage, vocab, plugins: [docs()] })
}
let ask = async (
  g: Graph,
  name: string,
  args: Record<string, unknown>,
): Promise<Bundle[]> =>
  await tools[name]!({ entity: { eid: 'call' }, call: { args } }, g)
let apply = async (g: Graph, bundles: Bundle[]) =>
  await g.apply(await ask(g, 'graph_apply', { bundles }))
let body = async (g: Graph): Promise<unknown> =>
  ((await g.get(['draft']))[0].doc as { body?: unknown }).body

let shown = async (g: Graph) =>
  (await ask(g, 'graph_show', { ids: ['draft'] }))[0]

for (let kind of ['doc', 'design', 'persona']) {
  let showing = fresh(kind)
  test(`${kind} bodies show a read token of the body`, async () => {
    assertEquals((await shown(showing)).$was!.doc.body, token('first'))
  })

  let replacing = fresh(kind)
  let first = await shown(replacing)
  test(`${kind} bodies use the read token for whole replacements`, async () => {
    await apply(replacing, [{
      entity: first.entity,
      doc: { body: 'second' },
      $was: first.$was,
    }])
    assertEquals(await body(replacing), 'second')
  })

  let replaced = fresh(kind)
  let stale = await shown(replaced)
  await apply(replaced, [{
    entity: stale.entity,
    doc: { body: 'second' },
    $was: stale.$was,
  }])
  test(`${kind} bodies refuse a replacement under a stale read token`, async () => {
    let refused = await assertRejects(
      () =>
        apply(replaced, [{
          entity: stale.entity,
          doc: { title: 'lost', body: 'third' },
          $was: stale.$was,
        }]),
      Stale,
    )
    assertEquals(refused.current, 'second')
    assertEquals(refused.was, token('second'))
    assertEquals((await replaced.get(['draft']))[0].doc, {
      title: 'draft',
      body: 'second',
    })
  })

  let blind = fresh(kind)
  test(`${kind} bodies still accept replacements without a read token`, async () => {
    await apply(blind, [{ entity: { eid: 'draft' }, doc: { body: 'blind' } }])
    assertEquals(await body(blind), 'blind')
  })
}

let queried = async (g: Graph) =>
  (await ask(g, 'graph_query', { q: '.doc&*' }))[0]

let reading = fresh()
test('a query reads a body token', async () => {
  assertEquals((await queried(reading)).$was!.doc.body, token('first'))
})

let clearing = fresh()
let cleared = await queried(clearing)
test('a query body token guards clearing', async () => {
  await apply(clearing, [{
    entity: cleared.entity,
    doc: { body: null },
    $was: cleared.$was,
  }])
  assertEquals(await body(clearing), null)
})

let concurrent = fresh()
let before = await queried(concurrent)
await apply(concurrent, [{
  entity: before.entity,
  doc: { body: null },
  $was: before.$was,
}])
test('a query body token reports a concurrent clearing', async () => {
  let stale = await assertRejects(
    () =>
      apply(concurrent, [{
        entity: before.entity,
        doc: { body: 'lost' },
        $was: before.$was,
      }]),
    Stale,
  )
  assertEquals(stale.current, null)
  assertEquals(stale.was, null)
})

let firstWords: Bundle = {
  entity: { eid: 'draft' },
  doc: { body: 'first' },
  $was: { doc: { body: null } },
}
let absent = fresh('doc', null)
test('an absent body can be guarded when writing its first words', async () => {
  await apply(absent, [firstWords])
  assertEquals(await body(absent), 'first')
})

let written = fresh('doc', null)
await apply(written, [firstWords])
test('a guard on an absent body refuses once words are written', async () => {
  let stale = await assertRejects(() => apply(written, [firstWords]), Stale)
  assertEquals(stale.current, 'first')
})

test('a title projection cannot witness the body it did not read', async () => {
  let g = fresh()
  let [read] = await ask(g, 'graph_query', { q: '.doc&.fields=doc.title' })
  assertEquals(read.doc, { title: 'draft' })
  assertEquals(read.$was?.doc?.body, undefined)
})

// A source and its replica, the replica holding what the source first said.
let replicated = async (body: string) => {
  let source = fresh(), copy = fresh()
  await source.apply([{ entity: { eid: 'draft' }, doc: { body } }])
  return { source, copy }
}
let mirror = async ({ source, copy }: { source: Graph; copy: Graph }) =>
  await copy.apply(await source.get(['draft']), {
    trusted: true,
    replica: true,
  })

let witnessed = await replicated('first')
test('a replica accepts a witnessed body', async () => {
  await mirror(witnessed)
  assertEquals(await body(witnessed.copy), 'first')
})

let later = await replicated('first')
await mirror(later)
await later.source.apply([{
  entity: { eid: 'draft' },
  doc: { body: 'second' },
}])
test('a replica accepts a later committed replacement', async () => {
  await mirror(later)
  assertEquals(await body(later.copy), 'second')
})
