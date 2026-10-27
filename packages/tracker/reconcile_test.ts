// Standing reconciliation never imports evidence or closes newer local groups.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { matches, reconcile, standing } from './reconcile.ts'
import { bare } from './fixture_test.ts'
import { comp } from './model.ts'

let row = (eid: string, extra: Partial<Bundle> = {}): Bundle => ({
  entity: { eid },
  bug: { fault: 'fault', last: '2026-10-18T12:00:00Z', hits: 9 },
  ...extra,
})
let local = row('local')
let fixed = row('remote', {
  resolved: {
    at: '2026-10-18T13:00:00Z',
    cause: 'fixed a race',
    recur: 'no',
  },
})

test('reconciliation matches migrated groups by fault and app, or global eid', () => {
  equal(matches(local, fixed), true)
  equal(matches(row('local', { during: { app: 'a' } }), fixed), false)
  equal(
    matches(
      row('local', { during: { app: 'a' } }),
      row('remote', {
        bug: { fault: 'fault', app: 'a' },
      }),
    ),
    true,
  )
  equal(matches(row('local', { bug: {} }), row('remote', { bug: {} })), false)
  equal(matches(row('local', { bug: {} }), row('local', { bug: {} })), true)
})

test('remote standing copies explanations but not counts or occurrences', () => {
  let patch = standing(local, fixed)!
  equal(patch.resolved, fixed.resolved)
  equal(patch.bug, undefined)
  equal(patch.error, undefined)
  equal(patch.entity.eid, 'local')
  equal(patch.$was?.bug?.last, token('2026-10-18T12:00:00Z'))
  equal(patch.$was?.resolved?.at, null)
})

test('remote reopening clears old standing and an obsolete explanation', () => {
  let before = row('local', {
    resolved: { at: 'old', cause: 'old', fix: 'old', recur: 'old' },
    archived: { at: 'old' },
    taken: { at: 'old' },
    regressed: { at: 'old' },
  })
  let patch = standing(before, local)!
  equal([patch.resolved, patch.archived, patch.taken, patch.regressed], [
    null,
    null,
    null,
    null,
  ])
  equal(standing(before, fixed)!.resolved, {
    at: '2026-10-18T13:00:00Z',
    cause: 'fixed a race',
    fix: null,
    recur: 'no',
  })
})

test('older remote resolution cannot erase newer local regression evidence', () => {
  let recent = row('local', {
    bug: { fault: 'fault', last: '2026-10-18T14:00:00Z' },
    regressed: { at: '2026-10-18T14:00:00Z' },
  })
  equal(standing(recent, fixed), undefined)
})

test('identical standing produces no write', () => {
  equal(standing(fixed, fixed), undefined)
})

// Seed outside the timed case; the graph seam checks admission and guards.
let g = bare()
let id = '1091f8e6-7e5a-4c35-b539-c16ccdef564a'
let remoteId = '2091f8e6-7e5a-4c35-b539-c16ccdef564a'
await g.apply([row(id)])
let stale = standing(row(id), { ...fixed, entity: { eid: remoteId } })!
await g.apply([{ entity: { eid: id }, bug: { last: '2026-10-18T14:00:00Z' } }])

test('a concurrent grouped occurrence refuses the stale standing patch', async () => {
  let refused = false
  try {
    await g.apply([stale])
  } catch {
    refused = true
  }
  equal(refused, true)
  equal((await g.get([id]))[0].resolved, undefined)
})

let desk = bare()
await desk.apply([row(id)])
let pages: string[] = []
let go = ((url: string | URL | Request) => {
  pages.push(new URL(String(url)).searchParams.get('query')!)
  return Promise.resolve(Response.json([
    { ...fixed, entity: { eid: remoteId } },
  ]))
}) as typeof fetch
// The signed transport and graph are exercised once at load, assertions stay fast.
await reconcile(desk, { url: 'https://tracker.example', secret: 'test' }, go)

test('a signed full-standing read reconciles migrated ids without remote imports', async () => {
  equal(pages, ['.bug * .order=entity.eid'])
  let [got] = await desk.get([id])
  equal(got.resolved, fixed.resolved)
  equal(comp(got, 'bug').hits, 9)
  equal(await desk.get([remoteId]), [])
})

// A remote that tags its answer, and answers 304 to a reader holding the tag.
let tagged = { at: '"t1"' }
let asked: (string | null)[] = []
let quiet = ((_url: string | URL | Request, init?: RequestInit) => {
  let since = new Headers(init?.headers).get('if-none-match')
  asked.push(since)
  return Promise.resolve(
    since == tagged.at
      ? new Response(null, { status: 304, headers: { etag: tagged.at } })
      : Response.json([{ ...fixed, entity: { eid: remoteId } }], {
        headers: { etag: tagged.at },
      }),
  )
}) as typeof fetch
let seen: { tag?: string } = {}
let remote = { url: 'https://tracker.example', secret: 'test' }
await reconcile(desk, remote, quiet, undefined, seen)
await reconcile(desk, remote, quiet, undefined, seen)
tagged.at = '"t2"'
await reconcile(desk, remote, quiet, undefined, seen)

test('a pass sends the tag the last whole pass read, and a remote that has not moved ends it', () => {
  equal(asked, [null, '"t1"', '"t1"'])
  equal(seen.tag, '"t2"')
})
