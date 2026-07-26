// The action menu names claim holders with the same chip id as every claim
// flag.
import { assertEquals } from '@std/assert'
import { cache, ent } from '../live.ts'
import { actionsFor } from './registry.ts'
import './Entity.tsx'

Deno.test('release names the session by its chip id', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      task: { eid: 'task', status: 'open', priority: 0 },
      claim: { eid: 'task', session_eid: 'session' },
    },
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'raw-session-uuid' },
    },
  }
  assertEquals(
    actionsFor(ent('task')).find((a) => a.label.startsWith('release'))?.label,
    'release S-31',
  )
  cache.value = {}
})
