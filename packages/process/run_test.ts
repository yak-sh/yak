// Real children, because a supervisor that only ever watched a fake one would
// prove nothing: the two escapes, the pidfile, the code file and the stream
// files are the thing under test. They are short-lived and the poll is 5ms, so
// the whole file runs in well under a second. A launch runs under every
// launcher this machine has, so Linux runs the macOS one too.

import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { EXIT, PROCESS } from './comp.ts'
import { gone, launchers, tracked, until } from './testing.ts'
import { adopt, launch, watch } from './run.ts'
import { store } from './store.ts'

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-process-' })
let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

for (let os of launchers) {
  Deno.test(`${os}: a launched child streams both its streams and stamps its exit`, async () => {
    let g = tracked()
    let run = await launch(store(g), {
      command: 'sh',
      args: ['-c', 'echo out; echo err >&2; exit 3'],
    }, { dir: dir(), poll: 5, os })
    assertEquals(await run.done, 3)

    let said = (await g.read(`.output.source=${run.eid}&*`))
      .map((b) => String(comp(b, 'content')?.body)).sort()
    assertEquals(said, ['err', 'out'])

    let row = (await g.read(`.${PROCESS}&*`))[0]
    assertEquals(row.entity.eid, run.eid)
    assertEquals(
      comp(row, PROCESS)?.command,
      'sh -c echo out; echo err >&2; exit 3',
    )
    assert(Number(comp(row, PROCESS)?.pid) > 0)
    assertEquals(comp(row, EXIT)?.code, 3)
  })

  // systemd expands the command line it launches, so an unescaped `$` reaches
  // the program as an empty string — a hosted shell wrote a heredoc with
  // every `${…}` deleted before anyone noticed (T-37332).
  Deno.test(`${os}: a command keeps every dollar the caller wrote`, async () => {
    let g = tracked()
    let run = await launch(store(g), {
      command: 'sh',
      args: ['-c', 'printf %s "$1"', 'sh', '${backend} $defs $$ $'],
    }, { dir: dir(), poll: 5, os })
    assertEquals(await run.done, 0)
    assertEquals(
      (await g.read(`.output.source=${run.eid}&*`))
        .map((b) => String(comp(b, 'content')?.body)),
      ['${backend} $defs $$ $'],
    )
  })

  Deno.test(`${os}: a finished run's running time stops at its end`, async () => {
    let run = await launch(store(tracked()), {
      command: 'sleep',
      args: ['0.05'],
    }, { dir: dir(), poll: 5, os })
    await run.done
    let took = run.elapsed()
    assert(took >= 50, `${took}ms`)
    let now = Date.now()
    await until(() => Date.now() > now + 5, 'the clock to move')
    assertEquals(run.elapsed(), took)
  })
}

Deno.test('a machine with no launcher is refused before anything starts', async () => {
  let d = dir()
  await assertRejects(() =>
    launch(store(tracked()), { command: 'true' }, { dir: d, os: 'plan9' })
  )
  assertEquals([...Deno.readDirSync(d)], [])
})

Deno.test('adopting a pid that is already gone stamps the ending, code unknown', async () => {
  let g = tracked()
  let run = await adopt(store(g), await gone(), { dir: dir(), poll: 5 })
  assertEquals(await run.done, null)
  let row = (await g.read(`.${PROCESS}&*`))[0]
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
  assertEquals(comp((await g.read(`.${PROCESS}&*`))[0], EXIT)?.code, null)
  // Stamped, so the next boot's reconcile has nothing left to pick up.
  assertEquals(await watch(store(g), { dir: dir(), poll: 5 }), [])
})

// The wrapper's `echo $code > file` creates the file empty and writes it a
// moment later; a load that stretches that moment let a read see the empty
// file and stamp a clean exit on a child that exited 3 (T-38290).
Deno.test('an exit-code file read before it is written is waited for, never read as 0', async () => {
  let g = tracked()
  let d = dir()
  await g.apply([{ entity: { eid: 'p1' }, [PROCESS]: { pid: await gone() } }])
  Deno.writeTextFileSync(`${d}/p1.code`, '')
  setTimeout(() => Deno.writeTextFileSync(`${d}/p1.code`, '3\n'), 30)
  let [run] = await watch(store(g), { dir: d, poll: 5 })
  assertEquals(await run.done, 3)
})

// And a wrapper slowed past the poll budget still has its code read: it is
// waited for for as long as it is alive, not for a fixed number of polls.
Deno.test('a wrapper slow to write the code is waited for while it lives', async () => {
  let g = tracked()
  let d = dir()
  let wrapper = new Deno.Command('sleep', { args: ['0.3'] }).spawn()
  await g.apply([{ entity: { eid: 'p1' }, [PROCESS]: { pid: await gone() } }])
  Deno.writeTextFileSync(`${d}/p1.pid`, `${wrapper.pid} ${await gone()}\n`)
  setTimeout(() => Deno.writeTextFileSync(`${d}/p1.code`, '3\n'), 200)
  let [run] = await watch(store(g), { dir: d, poll: 5 })
  assertEquals(await run.done, 3)
  await wrapper.status
})
