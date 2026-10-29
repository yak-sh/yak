import { test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { runs, type Serving } from './tools.ts'

test('a host that composed no handler has nothing to serve', async () => {
  await assertRejects(
    () =>
      runs({} as Serving).serve(
        { entity: { eid: 'serve' } },
        {} as Graph,
      ) as Promise<
        Bundle[]
      >,
    Error,
    'compose @yaks/api',
  )
})
