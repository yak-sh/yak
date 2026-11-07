// A write that changes nothing stamps, journals and fires nothing.
import { equal, test } from '@yaks/testing'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { comps } from './bundle.ts'
import { books, memory, slow } from './testing.ts'

let born = '2026-01-01T00:00:00.000Z'
let later = '2026-01-02T00:00:00.000Z'
let ada = '00000000-0000-4000-8000-000000000001'

// A graph holding one book and one doc, and what its rules, effects and
// journal heard of each write after that.
let shelf = async (async: boolean) => {
  let heard = {
    rules: [] as string[],
    effects: [] as string[],
    journal: [] as string[],
  }
  let said = (b: Bundle[]) =>
    b.flatMap((row) => comps(row).map(([c]) => `${row.entity.eid}.${c}`))
  let store = memory()
  let g = graph({
    vocab: books,
    storage: async ? slow(store) : store,
    plugins: [{
      name: 'ears',
      rules: [
        {
          phase: 'rules',
          match: '.doc',
          run: ({ entity }) => void heard.rules.push(entity.eid),
        },
        {
          phase: 'effect',
          match: '*book',
          run: ({ entity }) => void heard.effects.push(entity.eid),
        },
      ],
      hooks: {
        journal: (b) => {
          heard.journal.push(
            ...said(b).filter((s) => !/\.(created|updated)$/.test(s)),
          )
          return b
        },
      },
    }],
  })
  await g.apply([
    {
      entity: { eid: 'b1' },
      book: { pages: 3, status: 'draft' },
      doc: { title: 'Dune' },
    },
    { entity: { eid: 'd1' }, doc: { title: 'Notes' } },
  ], { now: born })
  heard.rules = [], heard.effects = [], heard.journal = []
  let write = async (...b: Bundle[]) => {
    let out = await g.apply(b.map((row) => ({ ...row, $actor: { by: ada } })), {
      now: later,
    })
    let rows = await g.get(['b1', 'd1'])
    return { out, rows: Object.fromEntries(rows.map((r) => [r.entity.eid, r])) }
  }
  return { write, heard }
}

for (let async of [false, true]) {
  test(`a write of what is stored stamps, journals and fires nothing (${async})`, async () => {
    let { write, heard } = await shelf(async)
    let { out, rows } = await write(
      { entity: { eid: 'b1' }, book: { pages: 3 }, doc: { body: null } },
      { entity: { eid: 'd1' }, doc: { title: 'Notes' }, review: null },
    )
    equal([rows.b1.updated, rows.d1.updated], [undefined, undefined])
    equal(heard, { rules: [], effects: [], journal: [] })
    equal(out.map((b) => b.entity.eid), ['b1', 'd1'])
    equal(out[0].book, { pages: 3 })
  })

  test(`a changed value is written as before (${async})`, async () => {
    let { write, heard } = await shelf(async)
    let { rows } = await write({ entity: { eid: 'b1' }, book: { pages: 4 } })
    equal(rows.b1.book, { pages: 4, status: 'draft' })
    equal(rows.b1.updated, { at: later, by: ada })
    equal(heard, { rules: ['b1'], effects: ['b1'], journal: ['b1.book'] })
  })

  test(`a mixed batch writes only what it changes (${async})`, async () => {
    let { write, heard } = await shelf(async)
    let { out, rows } = await write(
      { entity: { eid: 'd1' }, doc: { title: 'Notes' } },
      {
        entity: { eid: 'b1' },
        book: { status: 'draft' },
        doc: { title: 'Emma' },
      },
    )
    equal(rows.b1.doc, { title: 'Emma' })
    equal(rows.b1.updated, { at: later, by: ada })
    equal(rows.d1.updated, undefined)
    equal(heard, { rules: ['b1'], effects: [], journal: ['b1.doc'] })
    equal(out.map((b) => b.entity.eid), ['d1', 'b1'])
  })

  test(`a mark removed and given again in one batch is stamped anew (${async})`, async () => {
    let { write } = await shelf(async)
    await write({ entity: { eid: 'd1' }, sold: {} })
    let { rows } = await write(
      { entity: { eid: 'd1' }, sold: null },
      { entity: { eid: 'd1' }, sold: {} },
    )
    equal(rows.d1.sold, { at: later, by: ada })
  })

  test(`$touch writes what is stored (${async})`, async () => {
    let { write, heard } = await shelf(async)
    let { rows } = await write({
      entity: { eid: 'b1' },
      book: { pages: 3 },
      $touch: true,
    })
    equal(rows.b1.updated, { at: later, by: ada })
    equal(heard, { rules: ['b1'], effects: ['b1'], journal: ['b1.book'] })
  })
}
