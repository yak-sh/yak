// A malformed addressed descriptor reply must reject boot, not leave first
// paint waiting forever on an exception thrown from a signal effect.
import { assertRejects } from '@std/assert'
import { bootArchetypes } from './live_archetypes.ts'
import { landSub, unsubscribe, useRoute } from './live.ts'

Deno.test('malformed descriptor rejects the first-paint gate', async () => {
  let prior = useRoute(() => {})
  try {
    let rejected = assertRejects(() => bootArchetypes(), SyntaxError)
    landSub({
      sub: 'archetypes',
      replace: true,
      changes: [
        { eid: 'bad', name: 'entity', comp: { eid: 'bad' } },
        { eid: 'bad', name: 'archetype', comp: { tables: 'not JSON' } },
      ],
    })
    await rejected
  } finally {
    unsubscribe('archetypes')
    useRoute(prior)
  }
})
