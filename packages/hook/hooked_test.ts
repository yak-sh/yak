import { assertEquals } from '@std/assert'
import { edgeEid } from '@yaks/edge'
import { event, hooked, hookEid, type Request } from './hooked.ts'

let req = (r: Partial<Request>): Request => ({ id: '1', source: 'gh', ...r })

Deno.test('event: the sender header, then the JSON body, then the route', () => {
  assertEquals(
    [
      req({ headers: '{"X-GitHub-Event":"push"}', body: '{"type":"x"}' }),
      req({ body: '{"action":"opened"}' }),
      req({ body: 'not json', method: 'PUT', path: '/hook/a' }),
      req({}),
    ].map(event),
    ['push', 'opened', 'PUT /hook/a', 'POST /'],
  )
})

Deno.test('hooked: one entity per request, about whom it is for', () => {
  let r = req({ path: '/hook/a', body: '{}', verified: false })
  let eid = hookEid(r)
  assertEquals(hookEid(req({ path: '/elsewhere' })), eid)
  assertEquals(hooked(r, 'p-a'), [
    {
      entity: { eid },
      doc: { title: 'gh: POST /hook/a' },
      hook: {
        source: 'gh',
        event: 'POST /hook/a',
        payload: '{}',
        path: '/hook/a',
        verified: false,
      },
    },
    {
      entity: { eid: edgeEid(eid, 'about', 'p-a') },
      edge: { from: eid, to: 'p-a' },
      about: {},
    },
  ])
  assertEquals(hooked(r).length, 1)
})
