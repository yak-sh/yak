import { type Bundle, define, type H } from '@yaks/render'
// Domain faces and queries are checked with graph bundles, not a fleet boot.
import { equal, ok, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { render as preact } from '@yaks/preact'
import { render as text, tree } from '@yaks/text'
import { occurrences, openBugs, relatedTraces, views } from './views.ts'
import { inspectViews } from './inspect.ts'
import { fixture } from './fixture_test.ts'
import { runs } from './tools.ts'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { timingDoc } from '@yaks/timing/vocab'
import { trackerDoc } from './vocab.ts'
import { toolsDoc } from '@yaks/tools/vocab'

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
  let refs = [{
    view: 'Inline',
    match: true as const,
    render: <Node>(b: Bundle, h: H<Node>): Node =>
      h('a', { href: host.link(b.entity.eid) }, host.name(b.entity.eid)),
  }]
  let registry = define([...views.renderers, ...refs])
  let error = {
    entity: { eid: 'error' },
    error: {
      at: '2026-10-03',
      level: 'fatal',
      message: 'no row',
      commit: 'commit-new',
    },
    during: { entity: 'store', app: 'app', space: 'space', process: 'process' },
    breadcrumbs: {
      items: [{ at: '2026-10-03', category: 'fetch', message: 'GET /query' }],
    },
    exception: {
      stack: 'raw stack retained',
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
  let txt = text(registry, bug, 'Full', vocab, {
    ...host,
    errors: [error],
    show: (b: Bundle, view: string) =>
      tree(registry, b, view, vocab, {
        ...host,
        show: (ref: Bundle, v: string) => tree(registry, ref, v, vocab, host),
      }),
  }, 'plain')
  let html = renderToString(
    preact(registry, bug, 'Full', vocab, {
      ...host,
      errors: [error],
      show: (b: Bundle, view: string) =>
        preact(registry, b, view, vocab, {
          ...host,
          show: (b: Bundle, view: string) =>
            preact(registry, b, view, vocab, host),
        }),
    })!,
  )
  for (let output of [txt, html]) {
    for (
      let part of [
        'TypeError: no row',
        'B-7',
        '5 hits',
        'fatal',
        'group.ts:42:3',
        'dep.ts:2',
        'Newest occurrence',
        'Store / context',
        'store',
        'app',
        'space',
        'process',
        'commit-new',
        'raw stack retained',
        'GET /query',
      ]
    ) ok(output.includes(part), part)
  }
  ok(html.includes('href="/symbol"'))
  ok(html.includes('<details><summary>Stack and frames</summary>'))
  ok(html.includes('href="/?q=.trace"'))
  let tile = renderToString(
    preact(registry, bug, 'List.Tile', vocab, {
      ...host,
      show: (b: Bundle, view: string) => preact(registry, b, view, vocab, host),
    })!,
  )
  ok(tile.includes('href="/B-7"'))
  ok(tile.includes('first 2026-10-01'))
  ok(tile.includes('last 2026-10-03'))
  ok(tile.includes('href="/?q=.trace"'))
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

test('occurrence traces use request identity or bounded shared context, never arbitrary neighbours', async () => {
  let vocab = loadVocab([kernelDoc, toolsDoc, trackerDoc, timingDoc], [
    kernelKeywords,
  ])
  let g = graph({ vocab, storage: ram(vocab) })
  let error: Bundle = {
    entity: { eid: 'error' },
    error: { at: '2026-10-06T12:00:00Z' },
    during: { request: 'request', entity: 'store', space: 'space' },
  }
  let trace = (
    eid: string,
    during: Record<string, string>,
    at = '2026-10-06T12:00:00Z',
  ): Bundle => ({
    entity: { eid },
    trace: { at, op: 'request', name: 'read' },
    during,
  })
  await g.apply(
    ['request', 'store', 'space', 'other', 'another', 'process'].map((eid) => ({
      entity: { eid },
      during: {},
    })),
    { trusted: true },
  )
  await g.apply([
    trace('same-request', {
      request: 'request',
      entity: 'store',
      space: 'space',
    }),
    trace('nearby', { request: 'other', entity: 'store', space: 'space' }),
    trace('other-space', { entity: 'store', space: 'another' }),
    trace(
      'too-old',
      { entity: 'store', space: 'space' },
      '2026-10-06T11:54:59Z',
    ),
    trace('wrong-store', { entity: 'another', space: 'space' }),
  ], { trusted: true })
  let exact = relatedTraces(error)!
  equal((await g.read(exact.query)).map((b) => b.entity.eid), ['same-request'])
  let contextual = relatedTraces({
    ...error,
    during: { entity: 'store', space: 'space' },
  })!
  equal(
    new Set((await g.read(contextual.query)).map((b) => b.entity.eid)),
    new Set(['same-request', 'nearby']),
  )
  ok(contextual.label.includes('not a causal link'))
  equal(
    relatedTraces({
      entity: { eid: 'empty' },
      error: { at: '2026-10-06T12:00:00Z' },
    }),
    undefined,
  )
  let process = relatedTraces({
    entity: { eid: 'process-error' },
    during: { process: 'process' },
    error: { at: '2026-10-06T12:00:00Z' },
  })!
  await g.apply([trace('same-process', { process: 'process' })], {
    trusted: true,
  })
  equal((await g.read(process.query)).map((b) => b.entity.eid), [
    'same-process',
  ])
  let occurrenceView = inspectViews.find((r) =>
    r.view == 'Full' && r != inspectViews[0]
  )!
  equal(occurrenceView.asks!(error, { vocab } as never, {}).traces, exact.query)
  equal(
    occurrenceView.asks!(error, { vocab: fixture().vocab } as never, {}).traces,
    undefined,
  )
  let refs = occurrenceView.asks!(error, { vocab } as never, {})
    .references as string
  equal(
    new Set((await g.read(refs)).map((b) => b.entity.eid)),
    new Set(['request', 'store', 'space']),
  )
  let output = renderToString(
    preact(views, error, 'Full', vocab, {
      ...host,
      traces: [trace('same-request', {})],
      traceLabel: exact.label,
      tracesReady: true,
      show: (b: Bundle, view: string) => {
        if (b.entity.eid != 'same-request') return null
        equal(view, 'List.Tile')
        return preact(
          define([{
            view: 'List.Tile',
            match: true as const,
            render: <Node>(b: Bundle, h: H<Node>): Node =>
              h('a', { href: `/${b.entity.eid}` }, 'trace-face'),
          }]),
          b,
          view,
          vocab,
        )
      },
    })!,
  )
  ok(output.includes('href="/same-request"'))
  ok(output.includes('trace-face'))
})

test('bug page identifies newest and retained affected contexts without hiding older occurrences', () => {
  let errors: Bundle[] = [
    {
      entity: { eid: 'old' },
      error: { at: '2026-10-01', commit: 'older-code' },
      during: { entity: 'older-store' },
    },
    {
      entity: { eid: 'new' },
      error: { at: '2026-10-06', commit: 'newer-code' },
      during: { entity: 'newer-store' },
    },
  ]
  let output = text(views, bug, 'Full', fixture().vocab, {
    ...host,
    errors,
    show: (b: Bundle, view: string) =>
      view == 'Full' ? `occurrence-${b.entity.eid}` : b.entity.eid,
  }, 'plain')
  ok(output.indexOf('occurrence-new') < output.indexOf('occurrence-old'))
  for (let part of ['older-store', 'newer-store', 'older-code', 'newer-code']) {
    ok(output.includes(part), part)
  }
})
