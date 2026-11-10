import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { h } from 'preact'
import { render } from 'preact-render-to-string'
import { Table } from '@yaks/ui/parts'
import type { Bundle } from '@yaks/graph'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { docs } from './vocab.ts'
import { bindSort } from './sort-browser.ts'
import { Sort, sortAt, sorted, sortRows } from './Sort.ts'

let rows = [
  {
    values: ['Zebra', 1200, Date.parse('2026-01-02')],
    name: 'Zebra',
    money: '$1,200',
    date: 'Jan 2',
  },
  {
    values: ['Ant', 90, Date.parse('2026-02-01')],
    name: 'Ant',
    money: '$90',
    date: 'Feb 1',
  },
  {
    values: ['Bee', 9, Date.parse('2026-01-11')],
    name: 'Bee',
    money: '$9',
    date: 'Jan 11',
  },
]
let e: Bundle = { entity: { eid: sortAt('test/table') } }
let page = () => {
  let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
  let html = render(h(Sort, {
    e,
    onChange: () => {},
    cols: [null, 'num', null],
    heads: ['Name', 'Money', 'Date'],
    rows: rows.map((r) => ({
      values: r.values,
      content: [
        h(
          Table.Row,
          null,
          h(Table.Cell, null, r.name),
          h(Table.Cell, null, r.money),
          h(Table.Cell, null, r.date),
        ),
        h(Table.Row, null, h(Table.Cell, null, `${r.name}'s detail`)),
      ],
    })),
  }))
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  let done = Promise.resolve()
  let close = bindSort(document, {
    read: (eid) => front.ent(eid),
    write: (b) => {
      done = Promise.resolve(front.mutate([b])).then(() => {})
      return done
    },
  })
  let names = () =>
    [...document.querySelectorAll('[data-sort-values]')]
      .map((g) => g.querySelector('.Table_Cell')!.textContent)
  let press = async (column: number) => {
    document.querySelectorAll<HTMLButtonElement>('button')[column].click()
    await done
    await Promise.resolve()
  }
  return {
    document,
    names,
    press,
    front,
    close: () => {
      close()
      front.close()
    },
  }
}

let p = page()
let initial = p.names()
await p.press(1)
let money = p.names()
let head = p.document.querySelectorAll('[role=columnheader]')[1]
let ascending = [head.getAttribute('aria-sort'), head.textContent]
await p.press(1)
let reversed = p.names()
let descending = [head.getAttribute('aria-sort'), head.textContent]
await p.press(0)
let names = p.names()
let cleared = head.getAttribute('aria-sort')
await p.press(2)
let dates = p.names()
let details = [...p.document.querySelectorAll('[data-sort-values]')].map((g) =>
  g.lastElementChild!.textContent
)
let buttons = p.document.querySelectorAll('button[type=button]').length
let choice = p.front.ent(e.entity.eid)?.Sort
p.close()

test('sorts raw money, text and dates, reverses, and keeps detail rows attached', () => {
  equal(initial, ['Zebra', 'Ant', 'Bee'])
  equal(money, ['Bee', 'Ant', 'Zebra'])
  equal(ascending, ['ascending', 'Money ↑'])
  equal(reversed, ['Zebra', 'Ant', 'Bee'])
  equal(descending, ['descending', 'Money ↓'])
  equal(names, ['Ant', 'Bee', 'Zebra'])
  equal(cleared, 'none')
  equal(dates, ['Zebra', 'Bee', 'Ant'])
  equal(details, ["Zebra's detail", "Bee's detail", "Ant's detail"])
  equal(buttons, 3)
  equal(choice, { column: 2, direction: 'asc' })
})

let rebound = page()
await rebound.press(1)
let close = bindSort(rebound.document, {
  read: () => sorted(e, 0),
  write: () => {},
})
let after = rebound.names()
close()
rebound.close()
test('a remounted binding reads the owner’s existing sort choice', () => {
  equal(after, ['Ant', 'Bee', 'Zebra'])
})
test('equal values keep their order and missing values stay last in both directions', () => {
  for (let direction of ['asc', 'desc'] as const) {
    let all = [{ id: 'missing', n: null }, { id: 'a', n: 2 }, { id: 'b', n: 2 }]
    equal(
      sortRows(all, (r) => [r.n], { column: 0, direction }).map((r) => r.id),
      ['a', 'b', 'missing'],
    )
  }
})
