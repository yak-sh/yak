// A page past its cursor starts at the cursor: where the query holds a value
// in the order's column, the keyset bounds that column at the anchor's value,
// and the walk seeks there instead of reading every row the cursor passed.
import { equal, ok, test } from '@yaks/testing'
import { ID_URI, idDoc, idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([idDoc, {
  $vocabulary: { 'https://yak.sh/vocab/core': true, [ID_URI]: true },
  $defs: {
    entity: { component: true, properties: {} },
    thing: {
      component: true,
      kind: true,
      prefix: 'T',
      properties: {
        rank: { type: 'number', index: true },
        note: { type: 'string', index: true },
      },
    },
  },
}], [idKeywords])

// Every tenth thing has no rank and no note; one note is empty, and ranks
// run below zero.
let n = 6000
let rank = (i: number) => i % 10 ? i - 100 : undefined
let note = (i: number) =>
  i % 10 ? (i == 1 ? '' : `n${String(i).padStart(5, '0')}`) : undefined
let { driver, steps } = stepping()
let store = storage(driver, vocab, { number: true })
store.install()
store.tx((tx) =>
  tx.patch(Array.from({ length: n }, (_, i) => ({
    entity: { eid: `e${i}` },
    thing: { rank: rank(i), note: note(i) },
  })))
)
let page = (q: string) => {
  let before = steps()
  let eids = store.rows(`${q} .fields=entity.eid`).map((r) => r.eid as string)
  return { eids, steps: steps() - before }
}

// A page of one series: newest first, 50 at a time.
let mover = (depth: number) =>
  page(`.entity.num&entity.prefix=T&* .limit=50 .after=e${n - 1 - depth}`)

test('a numbered page past its cursor reads its own rows however deep the cursor', () => {
  let [shallow, deep] = [mover(100), mover(5000)]
  equal(deep.eids, Array.from({ length: 50 }, (_, i) => `e${n - 5002 - i}`))
  ok(deep.steps < 2 * shallow.steps, `${deep.steps} vs ${shallow.steps} steps`)
})

// The things an order reads, by the rule: valued rows by value, ascending or
// descending, past a valued anchor; past an anchor with no value, every row
// ascending and none descending; past a missing one, the first page.
let valued = (by: (i: number) => number | string | undefined) =>
  Array.from({ length: n }, (_, i) => i).filter((i) => by(i) != null)
let expect = (
  by: (i: number) => number | string | undefined,
  desc: boolean,
  anchor: number | null,
) => {
  let rows = valued(by).sort((x, y) => (by(x)! < by(y)! ? -1 : 1))
  if (desc) rows.reverse()
  let a = anchor == null ? undefined : by(anchor)
  let past = anchor == null
    ? rows
    : a == null
    ? (desc ? [] : rows)
    : rows.filter((i) => desc ? by(i)! < a : by(i)! > a)
  return past.slice(0, 3).map((i) => `e${i}`)
}
let cases: [string, (i: number) => number | string | undefined][] = [
  ['rank', rank],
  ['note', note],
]
for (let [prop, by] of cases) {
  for (let desc of [false, true]) {
    for (
      let [name, anchor] of [
        ['a valued anchor', 4321],
        ['an anchor with no value', 4320],
        ['a missing anchor', null],
      ] as const
    ) {
      test(`a page by ${desc ? '-' : ''}${prop} past ${name}`, () => {
        let after = anchor == null ? 'nobody' : `e${anchor}`
        equal(
          page(
            `.thing.${prop} .order=${
              desc ? '-' : ''
            }thing.${prop} .limit=3 .after=${after}`,
          ).eids,
          expect(by, desc, anchor),
        )
      })
    }
  }
}

// Under a test requiring the order's value, bare or a comparison, the page
// walks the order's index in either direction and starts at its cursor: near
// either end of the order, it reads about as many rows as the first page.
test('a page in a held order past its cursor reads its own rows wherever the cursor', () => {
  for (let prop of ['thing.rank', 'thing.note']) {
    for (let held of ['', prop == 'thing.rank' ? '>-1000' : '>m']) {
      for (let desc of ['', '-']) {
        let q = `.${prop}${held} .order=${desc}${prop} .limit=20`
        let first = page(q).steps
        for (let i of [n - 101, 1001]) {
          let { eids, steps } = page(`${q} .after=e${i}`)
          equal(eids.length, 20)
          ok(steps < 3 * first, `${q} .after=e${i}: ${steps} vs ${first} steps`)
        }
      }
    }
  }
})
