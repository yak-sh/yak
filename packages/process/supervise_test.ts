// A refused service never reaches the launch boundary.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { PROCESS, SERVICE } from './comp.ts'
import { tracked } from './testing.ts'
import { supervise } from './run.ts'
import { store } from './store.ts'

test('supervise refuses its own program, and whatever else the host names', async () => {
  let g = tracked()
  let self = (Deno.mainModule ?? '').split('/').pop() ?? ''
  assert(self, 'the test runner has a main module')
  let pass = supervise(store(g), {
    refuse: (c) => c.includes('effectsd.ts'),
  })
  await g.apply([
    {
      entity: { eid: 'e' },
      [SERVICE]: { command: `deno run -A src/${self}`, restart: 'always' },
    },
    {
      entity: { eid: 'f' },
      [SERVICE]: { command: 'deno run -A src/effectsd.ts', restart: 'always' },
    },
  ])
  assertEquals(await pass(), [])
  assertEquals(await g.read(`.${PROCESS}&*`), [])
})
