// Domain faces and queries are checked with graph bundles, not a fleet boot.
import { equal, ok, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { render as preact } from '@yaks/preact'
import { render as text, tree } from '@yaks/text'
import { occurrences, openBugs, views } from './views.ts'
import { inspectViews } from './inspect.ts'
import { fixture } from './fixture_test.ts'
import { runs } from './tools.ts'

let host = {
  id: () => 'B-7',
  name: (id: string) => id == 'symbol' ? 'group' : id,
  link: (id: string) => `/${id == 'bug' ? 'B-7' : id}`,
  when: (at: string) => at,
}
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
test('the same bug and error readings work in text and Preact, with related rows through the registry', () => {
  let vocab = fixture().vocab
  let error = {
    entity: { eid: 'error' },
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
  }
  let txt = text(views, bug, 'Full', vocab, {
    ...host,
    errors: [error],
    show: (b: typeof error, view: string) => tree(views, b, view, vocab, host),
  }, 'plain')
  let html = renderToString(preact(views, bug, 'Full', vocab, {
    ...host,
    errors: [error],
    show: (b: typeof error, view: string) =>
      preact(views, b, view, vocab, host),
  }))
  for (let output of [txt, html]) {
    for (
      let part of [
        'TypeError: no row',
        'B-7',
        '5 hits',
        'fatal',
        'group.ts:42:3',
        'dep.ts:2',
      ]
    ) ok(output.includes(part), part)
  }
  ok(html.includes('href="/symbol"'))
  let tile = renderToString(preact(views, bug, 'List.Tile', vocab, host))
  ok(tile.includes('href="/B-7"'))
  equal(inspectViews[0].asks!(bug, {} as never, {}), {
    errors: occurrences('bug'),
  })
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
