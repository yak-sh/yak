// The Effects page drawn through the inspector contract browse uses, over
// two workers, one silent and one long gone, and the runs owed by handler:
// the numbers up top, a row for each worker, what is running, and what each
// handler is owed.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import {
  type Answer,
  type Asks,
  type Bundle,
  effectEid,
  type Io,
} from '@yaks/inspect'
import { effectDoc } from './docs.ts'
import { inspectViews } from './page.ts'

let vocab = loadVocab([effectDoc, {
  $defs: {
    process: {
      component: true,
      type: 'object',
      properties: { pid: { type: 'integer' }, command: { type: 'string' } },
    },
    exit: { component: true, type: 'object' },
    send_letter: { effect: true, created: ['process'] },
    created: {
      component: true,
      type: 'object',
      properties: { at: { type: 'string', format: 'date-time' } },
    },
  },
}])

let now = Date.now()
let ago = (ms: number) => new Date(now - ms).toISOString()
let run = (run: string, handler: string, target: string, since: number) => ({
  run,
  handler,
  target,
  since: ago(since),
})
let process = (pid: number) => ({
  pid,
  command: `deno work --process yak-work --config /x/yak.json`,
})
let workers: Bundle[] = [
  {
    entity: { eid: 'w1' },
    process: process(41),
    created: { at: ago(2 * 3_600_000) },
    worker: {
      at: ago(400),
      running: 23,
      runs: [
        run('r2', 'mail_send', 'm1', 3_000),
        run('r1', 'session_run', 's1', 192_000),
      ],
      ran: 1234,
      errors: 3,
      history: [...Array(50).fill(0), ...Array(10).fill(5)],
      cpu: 0.34,
      lag: 12,
    },
  },
  {
    entity: { eid: 'w2' },
    process: process(42),
    worker: {
      at: ago(40_000),
      running: 1,
      runs: [run('r9', 'session_run', 's1', 60_000)],
      ran: 0,
      errors: 0,
      history: [],
    },
  },
  {
    entity: { eid: 'w3' },
    process: process(43),
    worker: { at: ago(3_600_000) },
  },
]
let tally = (tally: Record<string, number>): Answer => ({
  rows: [],
  tally,
  ready: true,
})
let owing = {
  owed: tally({ session_run: 2, mail_send: 1 }),
  claimed: tally({ session_run: 1 }),
  retrying: tally({ mail_send: 1 }),
  failed: tally({ builder_answer: 2 }),
}
let names: Record<string, string> = { s1: 'Fix the bug', m1: 'A letter' }

let drawn = (answers: Record<string, Answer>) => {
  let io = {
    vocab,
    ask: (asks: Asks) =>
      Object.fromEntries(
        Object.keys(asks).map((
          k,
        ) => [k, answers[k] ?? { rows: [], ready: true }]),
      ),
    get: () => undefined,
    link: (id: string) => `/${id}`,
    find: (q: string) => `/?q=${q}`,
    name: (id: string) => names[id] ?? id,
  } as unknown as Io
  let [page] = inspectViews
  let e = { entity: { eid: 'effects' } }
  let got = io.ask(page.asks!(e, io, {}))
  return parseHTML(
    `<main>${renderToString(h(page.Render, { e, got, io, ctx: {} }))}</main>`,
  ).document.querySelector('main')!
}
let all = (at: Element, q: string) => [...at.querySelectorAll(q)]
let words = (at: Element, q: string) =>
  all(at, q).map((n) => n.textContent?.trim())
let cells = (row?: Element | null) => row ? words(row, '[role=cell]') : []

let page = drawn({ workers: { rows: workers, ready: true }, ...owing })
let empty = drawn({ workers: { rows: [], ready: true }, ...owing })
let asking: Answer = { rows: [], ready: false }
let loading = drawn({ workers: asking, owed: asking })

let section = (at: Element, title: string) =>
  all(at, 'section').find((s) =>
    s.querySelector('.Section_Title')?.textContent?.startsWith(title)
  )!

test('the numbers up top count what is up, running, fast, waiting and failed', () => {
  equal(all(page, '.Metrics_Item').map((n) => words(n, 'div')), [
    ['1', 'worker up', '1 silent'],
    ['23', 'running now'],
    ['5.0', 'runs a second', '▁'.repeat(50) + '█'.repeat(10)],
    ['2', 'waiting', '1 retrying'],
    ['2', 'failed'],
  ])
  equal(
    page.querySelector('.Metrics_Item:last-child .Metrics_Value')?.className,
    'Metrics_Value Metrics_Value-negative',
  )
})

test('a row for each worker that said something lately, silent ones saying so', () => {
  let rows = all(section(page, 'Workers'), '[data-worker]')
  equal(rows.map((r) => r.getAttribute('data-worker')), ['w1', 'w2'])
  // The bars drawn in a cell aside, its words.
  equal(cells(rows[0]).map((c) => c?.replace(/[▁-▏·]/g, '').trim()), [
    'yak-work 41',
    '34%',
    '12 ms',
    '5.0',
    '23',
    '1,234',
    '3',
    '2h 0m',
  ])
  equal(cells(rows[1]).at(-1), 'silent 40s')
})

test('what is running, the longest first, named, and how many it left out', () => {
  let at = section(page, 'Running now')
  equal(at.querySelector('.Section_Count')?.textContent, '23')
  let rows = all(at, '[data-run]')
  equal(rows.map((r) => r.getAttribute('data-run')), ['r1', 'r2'])
  equal(cells(rows[0]), ['session_run', 'Fix the bug', 'yak-work', '3m 12s'])
  equal(rows[0].querySelector('a')?.getAttribute('href'), '/s1')
  equal(words(at, '.Table_Row-quiet'), ['and 21 more'])
})

test('each declared effect, the busiest first, its counts opening the runs they count', () => {
  let at = section(page, 'By handler')
  let rows = all(at, '[data-handler]')
  equal(rows.map(cells), [
    ['session_run', '1', '1', '', ''],
    ['mail_send', '', '1', '1', ''],
    ['builder_answer', '', '', '', '2'],
    ['send_letter', '', '', '', ''],
  ])
  equal(
    all(rows[2], 'a').map((a) => a.getAttribute('href')),
    [
      `/${effectEid('builder_answer')}`,
      '/?q=.effect.handler=builder_answer&.effect.state=failed&?effect',
    ],
  )
  equal(rows[3].className, 'Table_Row Table_Row-quiet')
})

test('with nobody working the pool, it says so, and what waits is a warning', () => {
  equal(
    empty.querySelector('.Metrics_Value')?.className,
    'Metrics_Value Metrics_Value-negative',
  )
  equal(
    section(empty, 'Workers').querySelector('[role=status]')?.textContent,
    'No process is working the pool, so nothing owed runs until one starts.',
  )
  equal(words(loading, '.Loading'), [
    'Loading the workers…',
    'Loading what is owed…',
  ])
})
