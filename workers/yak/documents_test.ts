import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { graph } from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { statements, storage } from '@yaks/sqlite'
import { adopt, fields, find, search } from '@yaks/fts'
import { hashEmbedder, meaning, schema, sweep } from '@yaks/embedding'
import { storeWords } from './vocab.ts'
import { type Extractor, indexDocument, pageBundle } from './documents.ts'
import { documentPages } from './document-graph.ts'
import { cited, type Hit, hits, type PageHit } from './document-search.ts'

let vocab = storeWords('app').vocab
let fixture = async () => {
  let db = open(':memory:')
  let st = storage(db, vocab, { extend: [search(fields(vocab), db)] })
  st.install()
  adopt(db, fields(vocab))
  for (let sql of schema()) db.query(sql)
  let g = graph({ vocab, storage: st, plugins: [documentPages()] })
  let document = crypto.randomUUID(), blob = 'a'.repeat(64)
  await g.apply([
    { entity: { eid: blob }, blob: { bytes: 10 } },
    {
      entity: { eid: document },
      attachment: { blob, mime: 'application/pdf', name: 'Minutes.pdf' },
    },
  ], { trusted: true })
  let calls: number[] = [], ocr = 0
  let source: Extractor = {
    pdf: (page) => {
      if (page) calls.push(page)
      return Promise.resolve({
        pages: 2,
        text: page == 1 ? 'The board approved the zoning ordinance.' : '',
        ...(page == 2 ? { image: 'scan' } : {}),
      })
    },
    ocr: () => {
      ocr++
      return Promise.resolve('The fire department received a new truck.')
    },
    markdown: () =>
      Promise.resolve('Office budget: road repairs cost 500 dollars.'),
  }
  return { g, db, document, blob, calls, source, ocr: () => ocr }
}

let a = await fixture(),
  b = await fixture(),
  c = await fixture(),
  d = await fixture()
let index = (f: typeof a, pdf = true, source = f.source) =>
  indexDocument(f.g, f.document, f.blob, pdf, source)
let lookup = (f: typeof a, words: string) =>
  hits(f.g, {
    words: (text, { limit }) =>
      Promise.resolve(find(f.db, fields(vocab), text, { limit })),
  }, words) as Promise<PageHit[]>

test('text and scanned pages are searched with their document and parser page number', async () => {
  await index(a)
  let found = await lookup(a, 'fire')
  assertEquals(found.map((h) => [h.document.name, h.page, h.location]), [[
    'Minutes.pdf',
    2,
    'Page 2',
  ]])
  let embed = hashEmbedder(), sql = statements(a.db)
  await sweep(sql, fields(vocab), embed)
  let near = await hits(
    a.g,
    {
      words: () => Promise.resolve([]),
      meaning: (words, opts) =>
        meaning(sql, fields(vocab), embed, words, { limit: opts?.limit }),
    },
    'fire truck',
  ) as PageHit[]
  assertEquals(near[0].page, 2)
  assertEquals(near[0].document.url, './api/blob/' + a.blob + '#page=2')
})

test('a repeated upload and rename reuse extracted pages; deleting bytes removes them', async () => {
  await index(b)
  await b.g.apply([{
    entity: { eid: b.document },
    attachment: { name: 'Board minutes.pdf' },
  }], { trusted: true })
  await index(b)
  assertEquals(b.calls, [1, 2])
  assertEquals(b.ocr(), 1)
  assertEquals(
    (await lookup(b, 'zoning'))[0].document.name,
    'Board minutes.pdf',
  )
  await b.g.apply([{ entity: { eid: b.blob }, $delete: true }], {
    trusted: true,
  })
  assertEquals(await lookup(b, 'zoning'), [])
})

test('an interrupted extraction resumes after its committed pages and source changes hide old text', async () => {
  let read = 0
  await assertRejects(() =>
    indexDocument(c.g, c.document, c.blob, true, {
      ...c.source,
      ocr: () => Promise.reject(Error('provider unavailable')),
    }, () => Promise.resolve(void read++))
  )
  assertEquals(read, 1)
  await index(c)
  assertEquals(c.calls, [1, 2, 2])
  await c.g.apply([{ entity: { eid: 'b'.repeat(64) }, blob: { bytes: 20 } }, {
    entity: { eid: c.document },
    attachment: { blob: 'b'.repeat(64) },
  }], { trusted: true })
  assertEquals(await lookup(c, 'zoning'), [])
})

test('Office conversion is indexed once and citations can only name retrieved pages', async () => {
  await index(d, false)
  let sources = await lookup(d, 'repairs')
  assertEquals(sources[0].location, 'Document')
  let answer = (citations: unknown[]) => ({
    response: JSON.stringify({ answer: '500 dollars', citations }),
  })
  assertEquals(
    (cited(answer([1]), sources).citations[0] as PageHit).document.name,
    'Minutes.pdf',
  )
  assertThrows(
    () => cited(answer([sources.length + 1]), sources),
    Error,
    'invalid citations',
  )
})

let e = await fixture()
test('removing and restoring a source extracts again; a late old completion cannot republish it', async () => {
  await index(e)
  await e.g.apply([{ entity: { eid: e.document }, attachment: null }], {
    trusted: true,
  })
  assertEquals(await e.g.read('zoning .document_page&*'), [])
  assertEquals((await e.g.get([e.document]))[0].document_text, undefined)
  await e.g.apply([{
    entity: { eid: e.document },
    attachment: { blob: e.blob, name: 'Minutes.pdf', mime: 'application/pdf' },
  }], { trusted: true })
  await index(e)
  assertEquals((await e.g.read('zoning .document_page&*')).length, 1)
  await e.g.apply([{
    entity: { eid: e.document },
    attachment: { name: 'notes.txt', mime: 'text/plain' },
  }], { trusted: true })
  await e.g.apply([
    pageBundle(e.document, e.blob, {
      page: 1,
      location: 'Page 1',
      text: 'Late zoning text',
    }),
  ], { trusted: true })
  assertEquals(await e.g.read('zoning .document_page&*'), [])
})

test('a row matches beside document pages, and an answer cites it by title', async () => {
  let meeting = crypto.randomUUID()
  await d.g.apply([{
    entity: { eid: meeting },
    doc: { title: 'Board meeting', body: 'Road repairs are on the agenda.' },
  }], { trusted: true })
  let sources = await lookup(d, 'repairs') as Hit[]
  assertEquals(sources.map((s) => 'document' in s ? 'page' : s.title).sort(), [
    'Board meeting',
    'page',
  ])
  let row = sources.findIndex((s) => !('document' in s)) + 1
  assertEquals(
    cited(
      { response: JSON.stringify({ answer: 'Tuesday', citations: [row] }) },
      sources,
    )
      .citations,
    [{ eid: meeting, title: 'Board meeting', components: ['doc'] }],
  )
})
