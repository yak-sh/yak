import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { parseQuery, resolveRefs } from '../../query.ts'
import {
  applyLocal,
  cache,
  ent,
  findEid,
  landSub,
  predsToQuery,
  queryEids,
  querySubscription,
  useRoute,
} from '../../live.ts'
import { held } from '../../host_testing.ts'
import { sessionsOf } from './Dashboard.tsx'
import '../Entity.tsx'

let claim = (eid: string, project: string, at: string) => ({
  task: { eid },
  claim: { eid, session: 's', at },
  filed: { eid, project },
})
cache.value = {
  s: { session: { eid: 's', id: 's' } },
  here: claim('here', 'project', '2026-09-01'),
  away: claim('away', 'elsewhere', '2026-09-02'),
}

let project = ent('project'), session = ent('s')
let here = ent('here'), away = ent('away')
// Build the row accessors once; choosing the newest claim is the measured act.
for (let e of [here, away]) {
  void e.task
  void e.claim
  void e.filed
}

test('Dashboard membership follows the newest claim, cached or not', () => {
  let of = (claims: typeof here[]) =>
    sessionsOf(project, [session], claims).map((s) => s.eid)
  assertEquals(of([here]), ['s'])
  // The newest claim wins even when it belongs elsewhere.
  assertEquals(of([here, away]), [])
})

test('project reads open wire subs and retain hits without cached far rows', () => {
  let project = 'abcdef10-0000-4000-8000-000000000001'
  let queries = [
    `.filed.project=${project}&.order=hot&.limit=8`,
  ]
  let frames: unknown[] = []
  let prior = useRoute((f) => frames.push(f))
  cache.value = {}
  try {
    for (let query of queries) {
      let preds = resolveRefs(parseQuery(query), findEid)
      assertEquals(typeof predsToQuery(preds), 'string')
      let before = frames.length
      let free = held({ query: preds })
      let ids = queryEids(preds)
      try {
        assertEquals(frames.length, before + 1)
        let read = querySubscription(preds)!
        assertEquals(read.state.status, 'loading')
        landSub({
          sub: read.sub,
          replace: true,
          changes: [
            { eid: 's', name: 'entity', comp: { num: 1 } },
            {
              eid: 's',
              name: 'session',
              comp: { id: 's' },
            },
          ],
        })
        assertEquals(ids.value, ['s'])
        applyLocal([{
          eid: 's',
          name: 'doc',
          comp: { title: 'unrelated edit' },
        }])
        assertEquals(ids.value, ['s'])
        assertEquals(querySubscription(preds)?.state.status, 'ready')
      } finally {
        free()
      }
    }
  } finally {
    useRoute(prior)
    cache.value = {}
  }
})
