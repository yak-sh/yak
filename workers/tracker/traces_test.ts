// Portable intake preserves references; queue trace admission is bounded by its authority.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { options, store, vocab } from './core.ts'
import { batch, consume } from './queue.ts'
import { door } from './door.ts'
import { sign } from './auth.ts'

let space = '00000000-0000-4000-8000-000000000001'
let other = '00000000-0000-4000-8000-000000000002'
let app = '00000000-0000-4000-8000-000000000003'
let root = '00000000-0000-4000-8000-000000000004'
let parent = '00000000-0000-4000-8000-000000000005'
let child = '00000000-0000-4000-8000-000000000006'
let fixture = () => store(ram(vocab, options), { sink: () => {} })
let rows = (scope = space): Bundle[] => [{
  entity: { eid: root },
  during: { space: scope, app },
  trace: { op: 'request', name: 'query', at: '2026-10-06T01:00:00.000Z' },
}, {
  entity: { eid: parent },
  during: { space: scope, app },
  span: { trace: root, op: 'request', name: 'query' },
  elapsed: { start: 0, ms: 0 },
  rows_read: { n: 5 },
  rows_written: { n: 0 },
  statements: { n: 2 },
}, {
  entity: { eid: child },
  during: { space: scope, app },
  span: { trace: root, parent, op: 'sql', name: 'select entity' },
  elapsed: { start: 0, ms: 0 },
  rows_read: { n: 3 },
  rows_written: { n: 0 },
  statements: { n: 1 },
}]

test('portable trace intake preserves reordered references and immutable metrics', async () => {
  let g = fixture(), capture = rows()
  await g.ingest([capture[2]])
  await g.ingest(capture.slice(0, 2))
  let found = ok(await g.trace(root))
  equal(found.spans.length, 2)
  equal(found.trace.trace, capture[0].trace)
  equal(
    (found.spans.find((s) => s.entity.eid == child)!.span as Comp).parent,
    parent,
  )
  await g.ingest(capture.map((r) => ({ ...r, rows_read: { n: 999 } })))
  equal(((await g.graph.get([child]))[0].rows_read as Comp).n, 3)
  equal((await g.bugs()).length, 0)
})

test('trace queue drops malformed captures and retains validation of nonrecords', async () => {
  let commits = 0
  let retried = 0
  let invalid: unknown[] = [
    [rows()[0], rows(other)[2]],
    [{ ...rows()[2], during: undefined }],
    [{ ...rows()[2], span: { trace: 'T-1', op: 'sql', name: 'select' } }],
    [{
      ...rows()[2],
      span: { trace: root, parent: 'S-1', op: 'sql', name: 'select' },
    }],
    [{ ...rows()[2], $delete: true }],
    [{ ...rows()[2], $was: {} }],
    [{ entity: { eid: child }, during: { space }, rows_read: { n: 3 } }],
  ]
  let acknowledged = 0, dropped = 0
  await consume(
    invalid.map((body) => ({
      body,
      ack: () => {
        acknowledged++
      },
      retry: () => {
        retried++
      },
    })),
    () => ({
      ingest: () => {
        commits++
        return Promise.resolve()
      },
    }),
    async () => {},
    () => {
      dropped++
      return Promise.resolve()
    },
  )
  // The metric-only batch is not a trace and still uses error validation.
  equal([commits, retried, acknowledged, dropped], [0, 1, 6, 6])
  equal(batch([rows()[2]]).scope, space)
})

test('authenticated trace list/show page spans and cannot cross spaces', async () => {
  let g = fixture()
  await g.ingest(rows())
  let nextRoot = '00000000-0000-4000-8000-000000000007'
  await g.ingest([{
    entity: { eid: nextRoot },
    during: { space, app },
    trace: { op: 'request', name: 'apply', at: '2026-10-06T02:00:00.000Z' },
  }])
  let secret = 'scratch-traces-secret'
  let route = door(g, space, secret)
  let ticket = async (scope: string) =>
    await sign({ scope, person: app, exp: Date.now() / 1000 + 60 }, secret)
  let token = await ticket(space)
  let request = (path: string, auth = token) =>
    new Request(`https://tracker.test${path}`, {
      headers: { authorization: `Bearer ${auth}` },
    })
  equal((await route(request('/traces', await ticket(other)))).status, 403)
  let list = await (await route(request(`/traces?app=${app}&limit=1`))).json()
  equal(list.rows.map((r: Bundle) => r.entity.eid), [nextRoot])
  equal(list.next, nextRoot)
  let rest = await (await route(
    request(`/traces?app=${app}&limit=1&after=${list.next}`),
  )).json()
  equal(rest.rows.map((r: Bundle) => r.entity.eid), [root])
  equal(rest.next, undefined)
  let page = await (await route(request(`/trace?eid=${root}&limit=1`))).json()
  equal(page.spans.length, 1)
  equal(page.trace.entity.eid, root)
  let more = await (await route(
    request(`/trace?eid=${root}&limit=1&after=${page.next}`),
  )).json()
  equal(more.spans.length, 1)
  equal(more.next, undefined)
  equal(new Set([page.spans[0].entity.eid, more.spans[0].entity.eid]).size, 2)
  equal((await route(request(`/trace?eid=${app}`))).status, 404)
  equal((await route(request('/traces?limit=101'))).status, 400)
  equal((await route(request('/trace?eid=T-1'))).status, 400)
  equal((await route(request(`/trace?eid=${root}&after=T-1`))).status, 400)
})
