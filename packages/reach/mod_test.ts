// Two graphs in memory as the members of one composition: a read spans them
// as one bundle per eid, and a write lands each component where its word lives.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { type Member, reach } from './mod.ts'

let text = { type: 'string' }
let core: VocabDoc = {
  $defs: { doc: { component: true, properties: { title: text } } },
}
let member = (at: string, own: VocabDoc): Member => {
  let vocab = loadVocab([core, own])
  let g = graph({ storage: ram(vocab), vocab })
  g.install()
  return {
    at,
    read: async (line) => await g.read(line),
    apply: (bundles, check) => g.apply(bundles, { check }) as Promise<Bundle[]>,
    vocab: () => Promise.resolve(own),
  }
}

let setup = async () => {
  let books = member('me/books', {
    $defs: {
      book: { component: true, properties: { pages: { type: 'number' } } },
    },
  })
  let loans = member('me/loans', {
    $defs: { loan: { component: true, properties: { to: text } } },
  })
  let fan = reach({ core: loadVocab([core]) })
  let both = [books, loans]
  await fan.written(both, undefined, [
    { entity: { eid: 'dune' }, book: { pages: 412 }, loan: { to: 'Ann' } },
    { entity: { eid: 'emma' }, book: { pages: 300 } },
  ])
  return { fan, both, books, loans }
}

let eids = (out: unknown) => (out as Bundle[]).map((b) => b.entity.eid)

test('a read spans members as one bundle per eid', async () => {
  let { fan, both } = await setup()
  let [dune] = await fan.read(both, '.book&.loan.to=Ann') as Bundle[]
  assertEquals(dune.book, { pages: 412 })
  assertEquals(dune.loan, { to: 'Ann' })
  assertEquals(dune._stores, { book: 'me/books', loan: 'me/loans' })
  assertEquals(eids(await fan.read(both, '.book&?loan')).sort(), [
    'dune',
    'emma',
  ])
  assertEquals(await fan.read(both, '.book&.count'), { count: 2 })
  assertEquals(
    eids(await fan.read(both, '.book&.order=-book.pages&.limit=1')),
    [
      'dune',
    ],
  )
})

test('one member answers alone, and a write lands each word in its member', async () => {
  let { fan, books, loans } = await setup()
  assertEquals(eids(await fan.read([books], '.book')).sort(), ['dune', 'emma'])
  assertEquals(eids(await fan.read([loans], '.loan')), ['dune'])
  assertEquals(eids(await books.read('.loan')), [])
})

test('a refusal in one member leaves every member unwritten', async () => {
  let { fan, books, loans } = await setup()
  let refusing: Member = {
    ...loans,
    apply: () => Promise.reject(new Error('no')),
  }
  await assertRejects(() =>
    fan.written([books, refusing], undefined, [{
      entity: { eid: 'wild' },
      book: { pages: 1 },
      loan: { to: 'Bo' },
    }])
  )
  assertEquals(eids(await books.read('.entity.eid=wild')), [])
})
