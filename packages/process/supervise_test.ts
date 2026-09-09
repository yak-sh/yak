// Desired state, driven by hand: every test writes a `service` row, calls the
// pass, and asserts what the row says afterwards. The children are real and
// short-lived (`exit 1`, `sleep 5`), because the thing under test is a spawn,
// an ending and a signal — nothing a fake process would prove. Passes are
// driven explicitly rather than on a timer, so a respawn is one call and the
// tally is exactly what the assertion reads.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { EXIT, PROCESS, SERVICE } from './comp.ts'
import { tracked, until } from './harness.ts'
import { supervise } from './run.ts'
import { store } from './store.ts'

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-supervise-' })
let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

// The backoff is real but tiny, so a respawn is the next call and not a wait.
let care = () => ({ dir: dir(), poll: 5, step: 5, ceiling: 60_000, grace: 20 })

let living = async (pid: number) =>
  (await new Deno.Command('kill', {
    args: ['-0', String(pid)],
    stdout: 'null',
    stderr: 'null',
  }).output()).success

Deno.test('a failing service is respawned once, onto the same row', async () => {
  let g = tracked()
  let pass = supervise(store(g), care())
  await g.apply([{
    entity: { eid: 'a' },
    [SERVICE]: { command: 'exit 1', restart: 'on-failure' },
  }])
  let row = async () => (await g.read(`.${SERVICE}`))[0]

  let first = await pass()
  assertEquals(first.length, 1)
  assertEquals(await first[0].done, 1)
  let before = Number(comp(await row(), PROCESS)?.pid)
  assert(before > 0)

  let second = await pass()
  assertEquals(second.length, 1)
  assertEquals(comp(await row(), SERVICE)?.attempts, 1)
  assertEquals(await second[0].done, 1)

  // One entity, two attempts: the new pid replaced the old, and the ending it
  // replaced went with it.
  assertEquals((await g.read(`.${PROCESS}`)).length, 1)
  assert(Number(comp(await row(), PROCESS)?.pid) != before)
})

Deno.test('restart never leaves the ending standing', async () => {
  let g = tracked()
  let pass = supervise(store(g), care())
  await g.apply([{
    entity: { eid: 'b' },
    [SERVICE]: { command: 'exit 1', restart: 'never' },
  }])
  assertEquals(await (await pass())[0].done, 1)
  assertEquals(await pass(), [])
  let row = (await g.read(`.${SERVICE}`))[0]
  assertEquals(comp(row, EXIT)?.code, 1)
  assertEquals(comp(row, SERVICE)?.attempts, undefined)
})

Deno.test('a stop ends an always service, and nothing respawns after it', async () => {
  let g = tracked()
  let pass = supervise(store(g), care())
  await g.apply([{
    entity: { eid: 'c' },
    [SERVICE]: { command: 'sleep 5', restart: 'always' },
  }])
  let run = (await pass())[0]
  assert(run.pid > 0)

  await g.apply([{ entity: { eid: 'c' }, stop: {} }])
  await pass() // TERM the group
  await until(
    async () => !(await living(run.pid)),
    'the child to take the TERM',
  )
  await run.done
  assertEquals(await pass(), [])
  assert(comp((await g.read(`.${SERVICE}`))[0], EXIT) != null)
})

Deno.test('deleting the service row takes its process down', async () => {
  let g = tracked()
  let pass = supervise(store(g), care())
  await g.apply([{
    entity: { eid: 'd' },
    [SERVICE]: { command: 'sleep 5', restart: 'always' },
  }])
  let run = (await pass())[0]
  await g.apply([{ entity: { eid: 'd' }, $delete: true }])
  await pass()
  await until(async () => !(await living(run.pid)), 'the child of a gone row')
  await run.done
})

Deno.test('supervise refuses its own program, and whatever else the host names', async () => {
  let g = tracked()
  let self = (Deno.mainModule ?? '').split('/').pop() ?? ''
  assert(self, 'the test runner has a main module')
  let pass = supervise(store(g), {
    ...care(),
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
  assertEquals(await g.read(`.${PROCESS}`), [])
})
