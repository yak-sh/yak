// Real children, because a supervisor that only ever watched a fake one would
// prove nothing: the two escapes, the pidfile, the code file and the stream
// files are the thing under test. They are short-lived and the poll is 5ms, so
// the whole file runs in well under a second.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { EXIT, PROCESS } from './comp.ts'
import { gone, tracked } from './harness.ts'
import { adopt, launch, watch } from './run.ts'
import { store } from './store.ts'

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-process-' })
let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

Deno.test('a launched child streams both its streams and stamps its exit', async () => {
  let g = tracked()
  let run = await launch(store(g), {
    command: 'sh',
    args: ['-c', 'echo out; echo err >&2; exit 3'],
  }, { dir: dir(), poll: 5 })
  assertEquals(await run.done, 3)

  let said = (await g.read(`.content.source=${run.eid}`))
    .map((b) => String(comp(b, 'content')?.body)).sort()
  assertEquals(said, ['err', 'out'])

  let row = (await g.read(`.${PROCESS}`))[0]
  assertEquals(row.entity.eid, run.eid)
  assertEquals(
    comp(row, PROCESS)?.command,
    'sh -c echo out; echo err >&2; exit 3',
  )
  assert(Number(comp(row, PROCESS)?.pid) > 0)
  assertEquals(comp(row, EXIT)?.code, 3)
})

Deno.test('adopting a pid that is already gone stamps the ending, code unknown', async () => {
  let g = tracked()
  let run = await adopt(store(g), await gone(), { dir: dir(), poll: 5 })
  assertEquals(await run.done, null)
  let row = (await g.read(`.${PROCESS}`))[0]
  assertEquals(comp(row, PROCESS)?.pid, run.pid)
  assertEquals(comp(row, PROCESS)?.command, null)
  assertEquals(comp(row, EXIT)?.code, null)
})

Deno.test('watch picks up an unfinished row and stamps the one already gone', async () => {
  let g = tracked()
  let dead = await gone()
  await g.apply([{ entity: { eid: 'p1' }, [PROCESS]: { pid: dead } }])
  let runs = await watch(store(g), { dir: dir(), poll: 5 })
  assertEquals(runs.map((r) => r.eid), ['p1'])
  assertEquals(await runs[0].done, null)
  assertEquals(comp((await g.read(`.${PROCESS}`))[0], EXIT)?.code, null)
  // Stamped, so the next boot's reconcile has nothing left to pick up.
  assertEquals(await watch(store(g), { dir: dir(), poll: 5 }), [])
})
