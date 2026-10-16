// Query writes use the graph's schema and the same address/write door as bundles.
import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { runs } from './tools.ts'
import { Refused } from './errors.ts'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object', wire: false, properties: {} },
    book: {
      component: true,
      type: 'object',
      properties: {
        pages: { type: 'integer' },
        title: { type: 'string' },
        read: { type: 'boolean' },
      },
    },
    tag: { component: true, type: 'object', properties: {} },
  },
})
let g = graph({ storage: ram(vocab), vocab })
let apply = runs().graph_apply
let ask = (args: Record<string, unknown>): Bundle[] =>
  apply({ entity: { eid: 'call' }, call: { args } }, g) as Bundle[]
let write = (q: string) => ask({ q })

for (let target of ['.entity.eid=book:dune', 'book:dune']) {
  test(`query apply types a patch with target ${target}`, () => {
    assertEquals(
      write(
        `${target} .book.pages=500 .book.title="500 pages" .book.read=false !tag`,
      ),
      [{
        entity: { eid: 'book:dune' },
        book: { pages: 500, title: '500 pages', read: false },
        tag: null,
      }],
    )
  })
}

test('query apply clears properties, ensures components and preserves bundle input', () => {
  assertEquals(write('$new .book.title=null .tag'), [{
    entity: { eid: '$new' },
    book: { title: null },
    tag: {},
  }])
  assertEquals(write('.entity.eid=$new .book.title="null"'), [{
    entity: { eid: '$new' },
    book: { title: null },
  }])
  let bundles = [{ entity: { eid: '$new' }, book: { title: 'Dune' } }]
  assertEquals(ask({ bundles }), bundles)
})

test('query apply refuses ambiguous, unsupported and empty writes', () => {
  for (
    let q of [
      '',
      '.book.pages=500',
      'book:dune',
      'book:dune stray .book.pages=500',
      '.entity.eid=a .entity.eid=b .book.pages=500',
      '.entity.eid=a,b .book.pages=500',
      'book:dune .book.pages>500',
      'book:dune .limit=2 .book.pages=500',
      'book:dune .book.pages=500|.book.pages=600',
      'book:dune .book.pages=oops',
      'book:dune .book.read=1',
      'book:dune .book.missing=1',
      'book:dune .missing',
      'book:dune .book.title="unclosed',
    ]
  ) assertThrows(() => write(q), Refused, undefined, q)
  assertThrows(() => ask({}), Refused, 'needs q or bundles')
  assertThrows(
    () => ask({ q: 'book:dune .tag', bundles: [] }),
    Refused,
    'not both',
  )
})

let fresh = '00000000-0000-4000-8000-000000000001'
let freshGraph = graph({ storage: ram(vocab), vocab })
let aliasGraph = graph({ storage: ram(vocab), vocab })

test('query apply creates a fresh UUID and patches it through the normal write door', async () => {
  await freshGraph.apply(write(`${fresh} .book.pages=500`))
  await freshGraph.apply(write(`.entity.eid=${fresh} .book.pages=501`))
  assertEquals((await freshGraph.get([fresh]))[0].book, { pages: 501 })
})

test('query apply leaves $name creation to the normal write door', async () => {
  let [created] = await aliasGraph.apply(write('$new .book.title=Dune'))
  assertEquals(created.entity.eid.startsWith('$'), false)
  assertEquals((await aliasGraph.get([created.entity.eid]))[0].book, {
    title: 'Dune',
  })
})

let addressed = graph({
  storage: ram(vocab),
  vocab,
  plugins: [{
    name: 'addresses',
    address: (_, ids) =>
      new Map(
        ids.filter((id) => ['T-1', 'book:dune'].includes(id)).map((
          id,
        ) => [id, fresh]),
      ),
  }],
})
await addressed.apply([{ entity: { eid: fresh }, book: { title: 'Dune' } }])

test('query apply resolves human ids and names at the same write door as bundles', async () => {
  for (let id of ['T-1', 'book:dune']) {
    let [applied] = await addressed.apply(write(`${id} .book.pages=500`))
    assertEquals(applied.entity.eid, fresh)
  }
  assertEquals((await addressed.get([fresh]))[0].book, {
    title: 'Dune',
    pages: 500,
  })
})
