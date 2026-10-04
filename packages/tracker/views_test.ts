// Domain faces and queries are checked with graph bundles, not a fleet boot.
import { equal, ok, test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { type Host, Ux } from '@yaks/ux'
import { Bug, BugTile, Occurrence, occurrences, openBugs } from './views.ts'
import { fixture } from './fixture_test.ts'
import { runs } from './tools.ts'

let host = {
  id: () => 'B-7',
  name: (id: string) => id == 'symbol' ? 'group' : id,
  when: (at: string) => at,
} as Host
let bug = {
  entity: { eid: 'bug', num: 7 },
  doc: { title: 'TypeError: no row' },
  bug: {
    fault: 'call|typeerror: no row',
    hits: 5,
    people: 2,
    culprit: 'symbol',
    first: '2026-10-01',
    last: '2026-10-03',
  },
}
test('bug reads its doc title, number and history; occurrence frames link resolved code', () => {
  let query = ''
  let html = renderToString(h(
    Ux,
    { host },
    h(Bug, {
      e: bug,
      queryView: (_eid, line) => {
        query = line
        return h('p', null, 'retained errors')
      },
    }),
  ))
  ok(html.includes('TypeError: no row'))
  ok(html.includes('B-7'))
  ok(html.includes('5 hits'))
  ok(html.includes('href="/symbol"'))
  ok(html.includes('retained errors'))
  equal(query, occurrences('bug'))
  let tile = renderToString(h(Ux, { host }, h(BugTile, { e: bug })))
  ok(tile.includes('href="/B-7"'))
  let error = renderToString(h(
    Ux,
    { host },
    h(Occurrence, {
      e: {
        entity: { eid: 'e' },
        error: { at: '2026-10-03', level: 'fatal', message: 'no row' },
        exception: {
          frames: [{
            file: 'group.ts',
            line: 42,
            column: 3,
            function: 'group',
            app: true,
            module: 'module',
            symbol: 'symbol',
          }, { file: 'dep.ts', line: 2 }],
        },
      },
    }),
  ))
  ok(error.includes('href="/symbol"'))
  ok(error.includes('group.ts:42:3'))
  ok(error.includes('dep.ts:2'))
  ok(error.includes('fatal'))
})
test('open list and tools take worst first, and bug errors newest first', async () => {
  let g = fixture()
  await g.apply([
    { entity: { eid: 'small' }, bug: { hits: 1 }, doc: { title: 'small' } },
    { entity: { eid: 'worst' }, bug: { hits: 20 }, doc: { title: 'worst' } },
    { entity: { eid: 'resolved' }, bug: { hits: 50 }, resolved: {} },
    { entity: { eid: 'archived' }, bug: { hits: 100 }, archived: {} },
    { entity: { eid: 'old' }, error: { bug: 'worst', at: '2026-10-01' } },
    { entity: { eid: 'new' }, error: { bug: 'worst', at: '2026-10-03' } },
  ], { trusted: true })
  equal((await g.read(openBugs)).map((b) => b.entity.eid), ['worst', 'small'])
  equal((await g.read(occurrences('worst'))).map((b) => b.entity.eid), [
    'new',
    'old',
  ])
  equal(
    (await runs().bug_list({ entity: { eid: 'call' } }, g)).map((b) =>
      b.entity.eid
    ),
    ['worst', 'small'],
  )
  equal(
    (await runs().bug_show({
      entity: { eid: 'call' },
      call: { args: { bug: 'worst' } },
    }, g)).map((b) => b.entity.eid),
    ['worst', 'new', 'old'],
  )
})
