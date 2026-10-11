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

for (let kind of ['doc', 'design', 'persona']) {
  test(`${kind} bodies use the read token for whole replacements`, async () => {
    let g = fresh(kind)
    let [read] = await ask(g, 'graph_show', { ids: ['draft'] })
    assertEquals(read.$was!.doc.body, token('first'))
    await apply(g, [{
      entity: read.entity,
      doc: { body: 'second' },
      $was: read.$was,
    }])
    let stale = await assertRejects(
      () =>
        apply(g, [{
          entity: read.entity,
          doc: { title: 'lost', body: 'third' },
          $was: read.$was,
        }]),
      Stale,
    )
    assertEquals(stale.current, 'second')
    assertEquals(stale.was, token('second'))
    assertEquals((await g.get(['draft']))[0].doc, {
      title: 'draft',
      body: 'second',
    })
  })

  test(`${kind} bodies still accept replacements without a read token`, async () => {
    let g = fresh(kind)
    await apply(g, [{ entity: { eid: 'draft' }, doc: { body: 'blind' } }])
    assertEquals(await body(g), 'blind')
  })
}

test('a query body token guards clearing and reports concurrent text', async () => {
  let g = fresh()
  let [read] = await ask(g, 'graph_query', { q: '.doc&*' })
  assertEquals(read.$was!.doc.body, token('first'))
  await apply(g, [{
    entity: read.entity,
    doc: { body: null },
    $was: read.$was,
  }])
  assertEquals(await body(g), null)
  let stale = await assertRejects(
    () =>
      apply(g, [{
        entity: read.entity,
        doc: { body: 'lost' },
        $was: read.$was,
      }]),
    Stale,
  )
  assertEquals(stale.current, null)
  assertEquals(stale.was, null)
})

test('an absent body can be guarded when writing its first words', async () => {
  let g = fresh('doc', null)
  let write: Bundle = {
    entity: { eid: 'draft' },
    doc: { body: 'first' },
    $was: { doc: { body: null } },
  }
  await apply(g, [write])
  let stale = await assertRejects(() => apply(g, [write]), Stale)
  assertEquals(stale.current, 'first')
})

test('a title projection cannot witness the body it did not read', async () => {
  let g = fresh()
  let [read] = await ask(g, 'graph_query', { q: '.doc&.fields=doc.title' })
  assertEquals(read.doc, { title: 'draft' })
  assertEquals(read.$was?.doc?.body, undefined)
})

test('a replica accepts a witnessed body and its later committed replacement', async () => {
  let source = fresh()
  let copy = fresh()
  await source.apply([{ entity: { eid: 'draft' }, doc: { body: 'first' } }])
  await copy.apply(await source.get(['draft']), {
    trusted: true,
    replica: true,
  })
  assertEquals(await body(copy), 'first')
  await source.apply([{ entity: { eid: 'draft' }, doc: { body: 'second' } }])
  await copy.apply(await source.get(['draft']), {
    trusted: true,
    replica: true,
  })
  assertEquals(await body(copy), 'second')
})
