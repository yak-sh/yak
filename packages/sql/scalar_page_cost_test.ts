// A mandatory scalar test reads a page in its component's owner order,
// including through the platform's privacy screen.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { memberDoc } from '../member/comp.ts'
import { privacy } from '../member/privacy.ts'
import { stepping } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { parse } from '@yaks/query'
import { compile, DEPTH, insert, lit, renderStable, VARIABLES } from './mod.ts'

let vocab = loadVocab([memberDoc, {
  $defs: {
    entity: { component: true },
    note: {
      component: true,
      properties: { text: { type: 'string' } },
    },
    rare: {
      component: true,
      properties: { text: { type: 'string' } },
    },
    tombstone: { component: true },
  },
}])
let { driver, steps } = stepping(), store = storage(driver, vocab)
store.install()
store.raise()
for (let start = 0; start < 2048; start += 256) {
  let owners = Array.from({ length: 256 }, (_, i) => ({
    id: start + i + 1,
    eid: `row-${start + i + 1}`,
  }))
  driver.query(insert('entity', ...owners))
  driver.query(insert(
    'note',
    ...owners.map((r) => ({
      entity: r.id,
      text: r.id == 2047 ? null : r.id == 2046 ? '' : 'common',
    })),
  ))
}
driver.query(insert('entity', { id: 2049, eid: 'without-note' }))
driver.query(insert(
  'rare',
  ...Array.from({ length: 20 }, (_, i) => ({ entity: i + 1, text: 'common' })),
))
driver.query(insert('_privacy', { entity: 2048, person: 2 }))
let visibility = {
  entity: privacy({ owners: [], through: [], floors: [] }).seen(
    'row-1',
    'editor',
  ),
}
for (let screened of [false, true]) {
  let fallback = renderStable(
    compile(parse('.note.text=common .limit=50'), vocab, {
      ...screened ? { visibility } : {},
      derived: {
        'note.text': { tag: 'text', worn: false, expr: () => lit('common') },
      },
    }),
    VARIABLES,
    DEPTH,
  )
  let statements = new Map([
    '.note.text=common',
    '.rare.text=common',
    '.note.text=""',
    '.note.text!=common',
  ].map((filter) => [
    filter,
    renderStable(
      compile(
        parse(`${filter} .limit=50`),
        vocab,
        screened ? { visibility } : {},
      ),
      VARIABLES,
      DEPTH,
    ),
  ]))
  let read = (filter: string) => {
    let at = steps(), rows = driver.query(statements.get(filter)!)
    return { ids: rows.map((r) => r.eid), cost: steps() - at }
  }
  test(`a ${screened ? 'private' : 'plain'} scalar page stops at its owners`, () => {
    let { ids, cost } = read('.note.text=common')
    let expected = Array.from(
      { length: screened ? 50 : 49 },
      (_, i) => `row-${2045 - i}`,
    )
    equal(ids, screened ? expected : ['row-2048', ...expected])
    ok(cost < 5000, `${cost} VM steps for 50 rows`)
  })
  test(`a ${screened ? 'private' : 'plain'} sparse scalar page reads only its component`, () => {
    let { ids, cost } = read('.rare.text=common')
    equal(ids, Array.from({ length: 20 }, (_, i) => `row-${20 - i}`))
    ok(cost < 2000, `${cost} VM steps for 20 rows`)
  })
  test(`a ${screened ? 'private' : 'plain'} scalar page retains missing values`, () => {
    for (let filter of ['.note.text=""', '.note.text!=common']) {
      equal(read(filter).ids, [
        'without-note',
        'row-2047',
        'row-2046',
      ])
    }
  })
  test(`a ${screened ? 'private' : 'plain'} derived page retains values without its component`, () => {
    let rows = driver.query(fallback).map((r) => r.eid)
    let expected = Array.from(
      { length: screened ? 49 : 48 },
      (_, i) => `row-${2047 - i}`,
    )
    equal(
      rows,
      screened
        ? ['without-note', ...expected]
        : ['without-note', 'row-2048', ...expected],
    )
  })
}
