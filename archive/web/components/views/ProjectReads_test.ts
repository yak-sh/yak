import { assertEquals } from '@std/assert'
import { matchQuery, parseQuery, resolveRefs } from '../../query.ts'
import {
  applyLocal,
  cache,
  dropQuery,
  ent,
  findEid,
  holdQuery,
  landSub,
  predsToQuery,
  querySubscription,
  useRoute,
} from '../../live.ts'
import { usageQuery } from './Usage.tsx'
import '../Entity.tsx'
import { sessionsOf } from './Dashboard.tsx'

Deno.test('Usage screens task ownership at the server, not in the view cache', () => {
  let query = parseQuery(usageQuery('project'))
  let session = { session: { requested_task: 'unloaded-task' } }
  let read = (eid: string) =>
    eid == 'unloaded-task' ? { filed: { project: 'project' } } : undefined
  assertEquals(matchQuery(session, query, read), true)
  assertEquals(matchQuery(session, query, () => undefined), false)
})

Deno.test('Dashboard requested-task membership needs no cached task', () => {
  cache.value = {
    s: { session: { eid: 's', id: 's', requested_task: 'unloaded-task' } },
  }
  assertEquals(
    sessionsOf(ent('project'), [ent('s')], [], new Set(['s']), new Set()).map(
      (s) => s.eid,
    ),
    ['s'],
  )
  // Newest claim overrides the requested task even when it belongs elsewhere.
  cache.value = {
    ...cache.peek(),
    claim: {
      task: { eid: 'claim' },
      claim: { eid: 'claim', session: 's' },
      filed: { eid: 'claim', project: 'elsewhere' },
    },
  }
  assertEquals(
    sessionsOf(
      ent('project'),
      [ent('s')],
      [ent('claim')],
      new Set(['s']),
      new Set(),
    ),
    [],
  )
})

Deno.test('Dashboard role-scope membership needs no cached role', () => {
  cache.value = { s: { session: { eid: 's', id: 's', role: 'unloaded-role' } } }
  assertEquals(
    sessionsOf(ent('project'), [ent('s')], [], new Set(), new Set(['s'])).map(
      (s) => s.eid,
    ),
    ['s'],
  )
})

Deno.test('project reads open wire subs and retain hits without cached far rows', () => {
  let project = 'abcdef10-0000-4000-8000-000000000001'
  let queries = [
    usageQuery(project),
    `.session.requested_task.filed.project=${project}&.fields=session.id`,
    `.session.role.role.scope=${project}&.fields=session.id`,
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
      let ids = holdQuery(preds)
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
              comp: { id: 's', requested_task: 'missing' },
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
        dropQuery(preds)
      }
    }
  } finally {
    useRoute(prior)
    cache.value = {}
  }
})
