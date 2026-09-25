import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { parseQuery, resolveRefs } from '../../query.ts'
import {
  applyLocal,
  cache,
  dropQuery,
  findEid,
  holdQuery,
  landSub,
  predsToQuery,
  querySubscription,
  useRoute,
} from '../../live.ts'
import '../Entity.tsx'

Deno.test('project reads open wire subs and retain hits without cached far rows', () => {
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
        dropQuery(preds)
      }
    }
  } finally {
    useRoute(prior)
    cache.value = {}
  }
})
