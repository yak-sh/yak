/// <reference lib="deno.ns" />
// `graph_schema` in its three sizes: the index, one component whole, and a
// kind — each as markdown and as one vocabulary document — plus the refusal
// for a word this graph has never heard of.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type KindDecl, loadVocab, type PropSchema } from '@yaks/vocab'
import { graph, proseOf, schemaOf } from '@yaks/graph'
import { connect, shop, text } from './testing.ts'
import { ram } from '@yaks/ram'

type Answer = { $defs: Record<string, PropSchema>; kinds?: KindDecls }
type KindDecls = Record<string, KindDecl>

// The tool list is read first, so the client checks the answer against the
// output schema the tool declares, as any MCP client does.
let asked = async (
  args: Record<string, unknown> = {},
  opts: Parameters<typeof connect>[0] = {},
) => {
  let client = await connect(opts)
  await client.listTools()
  let out = await client.callTool({ name: 'graph_schema', arguments: args })
  await client.close()
  return {
    doc: out.structuredContent as Answer,
    said: text(out),
    error: out.isError ? text(out) : '',
  }
}

test('bare, it is the index: every component, what it is, its types', async () => {
  let { doc, said } = await asked()
  // The shop's components, and the ones a call is written in — a graph that
  // serves tools knows both (@yaks/tools `toolsDoc`).
  assertEquals(Object.keys(doc.$defs), shop.all)
  assertEquals(doc.$defs.book, {
    component: true,
    type: 'object',
    description: 'a book on sale here',
    properties: {
      price: { type: 'number' },
      status: { type: 'string' },
      author: { type: 'string' },
    },
  })
  // Loaded without packages, each component is a heading of its own.
  assertStringIncludes(
    said,
    '## book (kind)\n\nA book on sale here.\n\nprice, status, author',
  )
  assertStringIncludes(said, 'first kind it carries: book, doc, review')
  assert(!said.includes('**'), said)
  // The kinds are said under `kinds`, so the index loads back naming an
  // entity as this graph does.
  assertEquals(Object.keys(doc.kinds!), shop.kinds)
  assertEquals(doc.kinds!.book.before, ['doc'])
  assertEquals(loadVocab(doc).kindOf({ book: {}, doc: {} }), 'book')
})

test('the index nests each component under the package declaring it', () => {
  let vocab = loadVocab([
    { package: '@shop/books', $defs: { book: shop.def('book')! } },
    { package: '@shop/words', $defs: { doc: shop.def('doc')! } },
  ])
  assertEquals(vocab.comp('book')?.package, '@shop/books')
  let said = proseOf(vocab)
  assertStringIncludes(
    said,
    '## @shop/books\n\n### book (kind)\n\nA book on sale here.',
  )
  assert(said.indexOf('## @shop/books') < said.indexOf('## @shop/words'))
  assertStringIncludes(
    proseOf(vocab, { comps: ['book'] }),
    'Declared by @shop/books.',
  )
})

test('named, it is the component as declared, with an example', async () => {
  let { doc, said } = await asked({ component: 'book' }, {
    guide: (comp) => comp == 'book' ? 'https://shop/guide/books.md' : undefined,
  })
  assertEquals(doc.$defs, {
    book: {
      ...shop.def('book'),
      examples: [{ price: 1, status: 'draft', author: '$other' }],
    },
  })
  // The answer is a vocabulary document, and loads as one; its entry names
  // its own kind as declared, so `kinds` does not say it again.
  assertEquals(loadVocab(doc).props('book'), ['price', 'status', 'author'])
  assertEquals(doc.kinds, undefined)
  for (
    let line of [
      '# book',
      'A kind: an entity with it is shown as a book, even beside doc.',
      '## Properties',
      '- price: number\n  What it costs, in pounds.',
      '- status: one of draft, shelved, sold',
      '- author: reference to entity\n  If that entity is deleted, this ' +
      'property is cleared.',
      '## Referenced by\n\n- review.book',
      '## Example\n\n    {"entity": {"eid": "$1"}, "book": {"price": 1, ' +
      '"status": "draft", "author": "$other"}}',
      'Documentation: https://shop/guide/books.md',
    ]
  ) assertStringIncludes(said, line)
  let { said: stamps } = await asked({ component: ['created', 'doc'] })
  assertStringIncludes(stamps, '# created')
  assertStringIncludes(stamps, '# doc')
  assertStringIncludes(stamps, 'server-owned')
})

// A loan is a book and a borrower, and a whole one carries the book's doc.
let lending = loadVocab([...shop.docs, {
  $defs: {
    borrower: {
      component: true,
      type: 'object',
      properties: { name: { type: 'string' } },
    },
  },
  kinds: {
    loan: {
      is: ['book', 'borrower'],
      with: { doc: true },
      examples: [{ book: {}, borrower: {}, doc: { title: 'Emma' } }],
    },
  },
}])

test('a kind is what it is whole, beside what a whole one carries', () => {
  let doc = schemaOf(lending, { kind: 'loan' })
  assertEquals(Object.keys(doc.$defs), ['book', 'borrower', 'doc'])
  assert(doc.$defs.book.examples)
  assertEquals(doc.$defs.doc.properties, {
    title: { type: 'string' },
    body: { type: 'string' },
  })
  assertEquals(doc.kinds!.loan.is, ['book', 'borrower'])
  assert(doc.kinds!.loan.examples)
  assertEquals(loadVocab(doc).kindOf({ book: {}, borrower: {} }), 'loan')
  let said = proseOf(lending, { kind: 'loan' })
  assertStringIncludes(said, '# book')
  assertStringIncludes(said, '# borrower')
  assertStringIncludes(said, '## Carried with\n\n### doc (kind)')
})

test('a kind no component is named for is asked for as a kind', async () => {
  let { doc } = await asked({ kind: 'loan' }, {
    graph: graph({ storage: ram(lending), vocab: lending }),
  })
  assertEquals(Object.keys(doc.$defs), ['book', 'borrower', 'doc'])
})

test('a JSON text property is exampled as valid JSON text', () => {
  let vocab = loadVocab({
    $defs: {
      config: {
        component: true,
        type: 'object',
        properties: { value: { type: 'string', format: 'json' } },
      },
    },
  })
  let [example] = schemaOf(vocab, { comps: ['config'] }).$defs.config.examples!
  assertEquals(example, { value: '{}' })
  assertEquals(vocab.check('config', example as Record<string, unknown>), [])
})

test('a word this graph never heard of is a refusal that says where to look', async () => {
  let { doc, error } = await asked({ component: 'bok' })
  assertStringIncludes(error, "no component 'bok'")
  assertStringIncludes(error, 'index')
  // A refusal is not in the shape the tool declares, so it carries none.
  assertEquals(doc, undefined)
  let { error: notAKind } = await asked({ kind: 'created' })
  assertStringIncludes(notAKind, 'not a kind')
  assertStringIncludes(notAKind, 'book, doc, review')
})
