import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { adopt } from './adopt.ts'
import { and, eq, scalar } from './ast.ts'
import { parse } from './parse.ts'

let vocab = loadVocab([{
  $defs: {
    book: {
      component: true,
      properties: {
        title: { type: 'string' },
        pages: { type: 'integer' },
        price: { type: 'number' },
        read: { type: 'boolean' },
        stamp: { type: 'string', stamped: true },
        rank: { type: 'number', computed: true },
        author: { type: 'string', ref: 'entity' },
        data: { type: 'object' },
      },
    },
    tag: { component: true, properties: {} },
  },
}])
let write = (q: string) => adopt(parse(q), vocab, { strict: true })

test('adoption types scalars by the vocabulary, not their spelling', () => {
  assertEquals(
    write('.book.title=500 .book.pages=500 .book.price=1e3 .book.read=false'),
    {
      book: { title: '500', pages: 500, price: 1000, read: false },
    },
  )
  assertEquals(write('.entity.eid=$book .book.title=Book'), {
    entity: { eid: '$book' },
    book: { title: 'Book' },
  })
})

test('adoption clears properties, removes components, and ensures markers', () => {
  assertEquals(write('.book.title=null !tag'), {
    book: { title: null },
    tag: null,
  })
  assertEquals(write('.tag'), { tag: {} })
  assertEquals(write('.book.pages=null'), { book: { pages: null } })
})

test('board adoption ignores filters but pins scalar equalities and forward walks', () => {
  assertEquals(
    adopt(parse('.book.author->person .book.pages>=5 .book.title=a,b'), vocab),
    {
      book: { author: 'person' },
    },
  )
  assertEquals(adopt(parse('.book.author<-person'), vocab), {})
  assertEquals(adopt(and(eq('book.title', scalar('a,b'))), vocab), {
    book: { title: 'a,b' },
  })
})

test('strict adoption never silently takes a partial write', () => {
  for (
    let q of [
      '.book.stamp=x',
      '.book.rank=1',
      '.book.pages=nope',
      '.book.read=1',
      '.book.data=x',
      '.missing.x=y',
      '.book.missing=x',
      '.book.title=a,b',
      '.book.pages=1..2',
      '.book.pages>1',
      'word',
      '.limit=2',
      '.book.title=x | .book.title=y',
      '.book.author.book.title=x',
      '.book.title=a .book.title=b',
      '!book .book.title=x',
      '.book.title=x !book',
    ]
  ) assertThrows(() => write(q), Error)
})

test('a write refuses a bare word, saying how to quote a value with spaces', () => {
  for (
    let [q, said] of [
      [
        '.book.title=Dune by Herbert',
        '.book.title=Dune ends at the space before "by": quote a value with ' +
        'spaces, .book.title="Dune by …", or write text holding quotes with ' +
        'bundles',
      ],
      [
        'dune .tag',
        '"dune" is a bare word, which writes nothing: quote a value with ' +
        'spaces, .doc.title="two words", or write text holding quotes with ' +
        'bundles',
      ],
    ]
  ) assertThrows(() => write(q), TypeError, said)
  assertEquals(write('.book.title="Dune by Herbert"'), {
    book: { title: 'Dune by Herbert' },
  })
})
