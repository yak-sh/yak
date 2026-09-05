/// <reference lib="deno.ns" />
// `graph_schema` in its three sizes: the index, one component whole, and a
// kind — plus the refusal for a word this graph has never heard of.

import { assert, assertEquals } from '@std/assert'
import { connect, result } from './harness.ts'

type Word = {
  name: string
  description?: string
  kind: boolean
  columns: unknown[]
  worn_with?: string[]
  references?: { out: unknown[]; in: unknown[] }
  example?: Record<string, unknown>
  guide?: string
}

let asked = async (
  args: Record<string, unknown> = {},
  opts: Parameters<typeof connect>[0] = {},
) => {
  let client = await connect(opts)
  let out = await client.callTool({ name: 'graph_schema', arguments: args })
  await client.close()
  return {
    said: result(out) as { comps: Word[]; kinds?: string[]; kind?: string },
    error: out.isError
      ? String((out.content as { text: string }[])[0].text)
      : '',
  }
}

Deno.test('bare, it is the index: every word, its line, its columns', async () => {
  let { said } = await asked()
  assertEquals(said.comps.map((c) => c.name), [
    'book',
    'created',
    'doc',
    'entity',
    'review',
    'updated',
  ])
  assertEquals(said.kinds, ['book', 'doc', 'review'])
  let book = said.comps.find((c) => c.name == 'book')!
  assertEquals(book.description, 'a book on sale here')
  // Names only — the index is the thing an agent can read whole.
  assertEquals(book.columns, ['price', 'status', 'author'])
  assertEquals(book.example, undefined)
})

Deno.test('named, it is the whole word: types, meaning, references, an example', async () => {
  let { said } = await asked({ component: 'book' }, {
    guide: (comp) => comp == 'book' ? 'https://shop/guide/books.md' : undefined,
  })
  let [book] = said.comps
  assertEquals(book.columns, [
    {
      prop: 'price',
      type: 'number',
      description: 'what it costs, in pounds',
    },
    { prop: 'status', type: 'enum', values: ['draft', 'shelved', 'sold'] },
    {
      prop: 'author',
      type: 'ref',
      ref: 'entity',
      notes: ['when the entity it names dies, this column is cleared'],
    },
  ])
  // What points at it, and what it points at.
  assertEquals(book.references, {
    out: [{ prop: 'author', to: 'entity' }],
    in: [{ comp: 'review', prop: 'book' }],
  })
  // A bundle that writes it, and where the host documents it.
  assertEquals(book.example, {
    entity: { eid: '$1' },
    book: { price: 1, status: 'draft', author: '$other' },
  })
  assertEquals(book.guide, 'https://shop/guide/books.md')
  // A server-owned column is named and said to be the server's.
  let { said: stamps } = await asked({ component: ['created', 'doc'] })
  assertEquals(stamps.comps.map((c) => c.name), ['created', 'doc'])
  let at = (stamps.comps[0].columns as { prop: string; notes?: string[] }[])[0]
  assert(at.notes?.[0].includes('server-owned'), JSON.stringify(at))
})

Deno.test('a kind is what an entity of it is made of', async () => {
  let { said } = await asked({ kind: 'book' })
  assertEquals(said.kind, 'book')
  // The word itself whole, then a line for each word it is worn with.
  assertEquals(said.comps.map((c) => c.name), ['book', 'doc'])
  assertEquals(said.comps[0].worn_with, ['doc'])
  assertEquals(said.comps[1].columns, ['title', 'body'])
})

Deno.test('a word this graph never heard of is a refusal that says where to look', async () => {
  let { error } = await asked({ component: 'bok' })
  assert(error.includes("no component 'bok'"), error)
  assert(error.includes('index'), error)
  // A component that is not a display kind, asked for as one, says so.
  let { error: notAKind } = await asked({ kind: 'created' })
  assert(notAKind.includes('not a kind'), notAKind)
  assert(notAKind.includes('book, doc, review'), notAKind)
})
