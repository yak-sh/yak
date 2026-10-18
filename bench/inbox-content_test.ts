/** Inbox paint marks refuse shells/fallbacks and require every thread's content. */
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { baseline, best, compare, type Run } from '@yaks/benchmark'
import { suite } from './inbox-content.ts'
import { COUNT, HISTORY, inboxPages } from './inbox-content.ts'

let rows = (kind: string, count = COUNT) =>
  Array.from(
    { length: count },
    (_, i) =>
      `<div data-thread="${i}">${kind} Inbox thread ${i}${
        kind == 'Person' ? ' Newest Inbox reply ' + i : ''
      }</div>`,
  ).join('')
let [person, project, detail] = inboxPages()
let personRows = rows('Person'), projectRows = rows('Project')
let expanded = personRows.replace(
  'data-thread="0">',
  'data-thread="0"><button aria-expanded="true"></button>',
)
let cases = [
  [
    'person refuses Show fallback',
    person,
    '<h1>Inbox</h1><div class="Show_Title">Owner</div>',
    false,
  ],
  [
    'project refuses Show fallback',
    project,
    '<h1>Inbox</h1><div class="Show_Title">Project</div>',
    false,
  ],
  ['person refuses empty Inbox', person, '<div class="Inbox"></div>', false],
  ['project refuses empty Inbox', project, '<div class="Inbox"></div>', false],
  [
    'person refuses loading frame',
    person,
    `<div class="Inbox"><p role="status">Loading inbox…</p>${personRows}</div>`,
    false,
  ],
  [
    'project refuses loading frame',
    project,
    `<div class="Inbox"><p role="status">Loading inbox…</p>${projectRows}</div>`,
    false,
  ],
  [
    'person paints all titles and newest replies',
    person,
    `<div class="Inbox">${personRows}</div>`,
    true,
  ],
  [
    'project paints all addressed titles',
    project,
    `<div class="Inbox">${projectRows}</div>`,
    true,
  ],
  [
    'person refuses missing thread',
    person,
    `<div class="Inbox">${rows('Person', COUNT - 1)}</div>`,
    false,
  ],
  [
    'project refuses unloaded title',
    project,
    `<div class="Inbox">${
      projectRows.replace('Project Inbox thread 0', '')
    }</div>`,
    false,
  ],
  [
    'person refuses unloaded newest reply',
    person,
    `<div class="Inbox">${
      personRows.replace('Newest Inbox reply 0', '')
    }</div>`,
    false,
  ],
  [
    'expanded thread waits for conversation history',
    detail,
    `<div class="Inbox">${expanded}</div>`,
    false,
  ],
  [
    'expanded thread paints loaded conversation history',
    detail,
    `<div class="Inbox">${
      expanded.replace(
        '</button>',
        `</button><div class="Inbox_Detail">${HISTORY}</div>`,
      )
    }</div>`,
    true,
  ],
] as const
for (let [name, page, html, expected] of cases) {
  let { document } = parseHTML(
    `<html><body><main class="Shell_Body">${html}</main></body></html>`,
  )
  let paint = new Function('document', `return ${page.painted}`)
  test(name, () => equal(paint(document), expected))
}

// The production registration declares zero slack. Exercise the shared banking
// path with these exact names: the best run wins, noise buys no headroom, and
// accepting a slower observation cannot lift a reference.

let measured = suite()
let run = (n: number): Run =>
  ({
    version: 1,
    suite: measured.name,
    metric: measured.metric,
    workload: measured.workload,
    runtime: 'fixture',
    cpu: 'fixture',
    benches: measured.benches.map((b) => ({
      ...b,
      better: 'lower',
      median: n,
    })),
  }) as Run
let triple = [run(130), run(100), run(120)]
test('Inbox banks the best of three with no noise allowance or upward rebanking', () => {
  let bank = baseline(triple, 0)
  equal(bank.tolerance, 0)
  equal(
    bank.benches.map((b) => [b.median, b.tolerance]),
    measured.benches.map(() => [100, 0]),
  )
  equal(
    compare(bank, best([run(140), run(101), run(110)])).length,
    measured.benches.length,
  )
  equal(compare(bank, best([run(140), run(100), run(110)])).length, 0)
  equal(
    baseline(run(150), 0, bank).benches.map((b) => b.median),
    measured.benches.map(() => 100),
  )
})
