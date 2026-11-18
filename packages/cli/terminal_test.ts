import { equal, test } from '@yaks/testing'
import { define } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import { printed } from './answer.ts'
import { show } from './terminal.ts'
import { show as terminal } from './tty.ts'

let vocab = loadVocab([])
let answer = [{ entity: { eid: '11111111-1111-4111-8111-111111111111' } }]
let named = { entity: { eid: '22222222-2222-4222-8222-222222222222' } }
let views = define([{
  view: 'Tile',
  match: true,
  needs: () => [named.entity.eid],
  load: () => Promise.resolve((_b, h) => h('b', {}, 'answer')),
}])

test('portable preparation hands its presenter the references the drawing reads', async () => {
  let lines: string[] = [], reads: string[][] = [], presentations = 0
  await show(
    { tui: true, out: (s) => lines.push(s) },
    views,
    vocab,
    answer,
    {},
    {
      lookup: (ids) => (reads.push(ids), [named]),
      query: () => [],
    },
    { readOnly: true },
    (prepared, rows, names, page, answers) => {
      presentations++
      equal(printed(prepared, vocab, rows, names), 'answer')
      equal(rows, answer)
      equal(names, [named])
      equal(page, undefined)
      equal([...answers], [])
    },
  )
  equal(presentations, 1)
  equal(reads, [[named.entity.eid]])
  equal(lines, [])
})

test('the command line paints a terminal answer through its supplied output', async () => {
  let lines: string[] = [], painted: string[] = []
  await terminal(
    {
      tui: false,
      out: (s) => lines.push(s),
      tty: { columns: 40, write: (s) => painted.push(s) },
    },
    views,
    vocab,
    answer,
    {},
    { lookup: () => [named], query: () => [] },
  )
  equal(lines, [])
  equal(painted, ['\x1b[1manswer\x1b[0m'])
})
