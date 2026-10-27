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

// A remote that tags its answer, answers 304 to a reader holding the tag, and
// names what moved since an older one while it knows.
let tagged = { at: '"t1"', moved: [] as string[] | null }
let asked: string[] = []
let quiet = ((url: string | URL | Request, init?: RequestInit) => {
  let params = new URL(String(url)).searchParams
  let held = new Headers(init?.headers).get('if-none-match')
  let headers = { etag: tagged.at }
  asked.push(
    held == tagged.at
      ? '304'
      : params.has('since')
      ? `since ${held}`
      : params.get('query')!,
  )
  return Promise.resolve(
    held == tagged.at
      ? new Response(null, { status: 304, headers })
      : params.has('since')
      ? Response.json({ moved: tagged.moved }, { headers })
      : Response.json([{ ...fixed, entity: { eid: remoteId } }], { headers }),
  )
}) as typeof fetch
let seen: { tag?: string } = {}
let remote = { url: 'https://tracker.example', secret: 'test' }
await reconcile(desk, remote, quiet, undefined, seen)
await reconcile(desk, remote, quiet, undefined, seen)
Object.assign(tagged, { at: '"t2"', moved: [remoteId] })
await reconcile(desk, remote, quiet, undefined, seen)
Object.assign(tagged, { at: '"t3"', moved: null })
await reconcile(desk, remote, quiet, undefined, seen)

test('a pass sends the tag it last read at, and reads only what moved since', () => {
  equal(asked.slice(0, 4), [
    '.bug * .order=entity.eid',
    '304',
    'since "t1"',
    `.bug * .entity.eid=${remoteId} .order=entity.eid`,
  ])
})

test('a pass whose tag the remote no longer knows reads whole', () => {
  equal(asked.slice(4), ['since "t2"', '.bug * .order=entity.eid'])
  equal(seen.tag, '"t3"')
})
