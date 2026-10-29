// Process bookkeeping through graph and liveness interfaces, with temporary receipt files.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { EXIT, PROCESS } from './comp.ts'
import { tracked } from './testing.ts'
import {
  adopt,
  clean,
  gone,
  launch,
  sweep,
  tail,
  vanished,
  watch,
} from './run.ts'
import { store } from './store.ts'

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-process-' })
let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

test('output stays until its caller cleans the finished run', () => {
  let at = dir()
  Deno.writeTextFileSync(`${at}/finished.out`, 'kept\n')
  Deno.writeTextFileSync(`${at}/finished.code`, '0\n')
  assertEquals(tail('finished', 1, { dir: at }), ['kept'])
  clean('finished', { dir: at })
  assertEquals(tail('finished', 1, { dir: at }), [])
  assertEquals([...Deno.readDirSync(at)], [])
})

test('a tail answers the last whole lines, however long they are', () => {
  let at = dir()
  let read = (body: string) => {
    Deno.writeTextFileSync(`${at}/p.out`, body)
    return (n: number) => tail('p', n, { dir: at })
  }
  let many = read(
    Array.from({ length: 20_000 }, (_, i) => `line ${i + 1}\n`).join('') +
      '\nlast',
  )
  assertEquals(many(3), ['line 20000', '', 'last'])
  assertEquals(many(0), [])
  let wide = read('a\n' + 'x'.repeat(200_000) + '\nend\n')
  assertEquals(wide(2), ['x'.repeat(200_000), 'end'])
  assertEquals(wide(9), ['a', 'x'.repeat(200_000), 'end'])
})

test('a sweep cleans only the runs that ended longer ago than its age', async () => {
  let at = dir()
  let past = new Date(Date.now() - 60_000)
  for (let eid of ['old', 'fresh']) {
    Deno.writeTextFileSync(`${at}/${eid}.out`, `${eid}\n`)
    Deno.writeTextFileSync(`${at}/${eid}.started`, String(past.getTime() - 1))
    Deno.writeTextFileSync(`${at}/${eid}.code`, '0\n')
  }
  Deno.utimeSync(`${at}/old.code`, past, past)
  assertEquals(await sweep(30_000, { dir: at }), 1)
  assertEquals(tail('old', 1, { dir: at }), [])
  assertEquals(tail('fresh', 1, { dir: at }), ['fresh'])
  assertEquals(await sweep(30_000, { dir: dir() + '/none' }), 0)
})

// Filesystem/graph setup and the sweep run once as a private scenario; the
// checks retain every protected-file and removed-file observation.
let protectedSweep = await (async () => {
  let at = dir()
  let g = tracked()
  let past = new Date(Date.now() - 60_000)
  let cases = [
    'finished',
    'foreign',
    'empty',
    'partial',
    'invalid',
    'running',
    'managed',
    'service',
    'directory',
    'symlink',
    'restarted',
  ]
  for (let eid of cases) {
    for (let ext of ['out', 'err', 'pid', 'started', 'code']) {
      Deno.writeTextFileSync(
        `${at}/${eid}.${ext}`,
        ext == 'code'
          ? '0\n'
          : ext == 'started'
          ? String(past.getTime() - 1)
          : 'keep',
      )
    }
    Deno.utimeSync(`${at}/${eid}.code`, past, past)
  }
  Deno.removeSync(`${at}/foreign.started`)
  for (
    let [eid, text] of [['empty', ''], ['partial', '0'], ['invalid', 'wat\n']]
  ) {
    Deno.writeTextFileSync(`${at}/${eid}.code`, text)
    Deno.utimeSync(`${at}/${eid}.code`, past, past)
  }
  Deno.removeSync(`${at}/directory.code`)
  Deno.mkdirSync(`${at}/directory.code`)
  Deno.removeSync(`${at}/symlink.code`)
  Deno.symlinkSync(`${at}/managed.code`, `${at}/symlink.code`)
  Deno.writeTextFileSync(`${at}/restarted.started`, String(Date.now()))
  await g.apply([
    { entity: { eid: 'running' }, process: { pid: 1 } },
    { entity: { eid: 'managed' }, session: {}, process: {}, exit: { code: 0 } },
    {
      entity: { eid: 'service' },
      service: { command: 'true' },
      exit: { code: 0 },
    },
  ])
  let removed = await sweep(30_000, { dir: at }, store(g))
  return { at, cases, removed }
})()
test('a sweep preserves incomplete, foreign and managed run files', () => {
  let { at, cases, removed } = protectedSweep
  assertEquals(removed, 1)
  assertEquals(Deno.readTextFileSync(`${at}/foreign.out`), 'keep')
  for (let eid of cases.slice(1)) {
    assertEquals(Deno.readTextFileSync(`${at}/${eid}.out`), 'keep', eid)
  }
  assertEquals(
    [...Deno.readDirSync(at)].some((e) => e.name == 'finished.out'),
    false,
  )
})

test('a machine with no launcher is refused before anything starts', async () => {
  let d = dir()
  await assertRejects(() =>
    launch(store(tracked()), { command: 'true' }, { dir: d, os: 'plan9' })
  )
  assertEquals([...Deno.readDirSync(d)], [])
})

test('adopting a pid that is already gone stamps the ending, code unknown', async () => {
  let g = tracked()
  let run = await adopt(store(g), 7002, {
    dir: dir(),
    running: () => Promise.resolve(false),
  })
  assertEquals(await run.done, null)
  let row = (await g.read(`.${PROCESS}&*`))[0]
  assertEquals(comp(row, PROCESS)?.pid, run.pid)
  assertEquals(comp(row, PROCESS), { pid: run.pid })
  assertEquals(comp(row, EXIT), {})
})

test('watch picks up an unfinished row and stamps the one already gone', async () => {
  let g = tracked()
  let dead = 7002
  let at = dir()
  Deno.writeTextFileSync(`${at}/p1.pid`, `7001 ${dead}\n`)
  await g.apply([{ entity: { eid: 'p1' }, [PROCESS]: { pid: dead } }])
  let opts = { dir: at, running: () => Promise.resolve(false) }
  let runs = await watch(store(g), opts)
  assertEquals(runs.map((r) => r.eid), ['p1'])
  assertEquals(await runs[0].done, null)
  assertEquals(comp((await g.read(`.${PROCESS}&*`))[0], EXIT), {})
  // Stamped, so the next boot's reconcile has nothing left to pick up.
  assertEquals(await watch(store(g), opts), [])
})

test('a run that ended without saying so is found; a live one, a launched one and the asker are not', async () => {
  let g = tracked()
  let at = dir()
  Deno.writeTextFileSync(`${at}/launched.started`, '1')
  await g.apply(['me', 'dead', 'live', 'launched', 'ended'].map((eid) => ({
    entity: { eid },
    [PROCESS]: { pid: eid == 'live' || eid == 'ended' ? Deno.pid : 99 },
    // A thread its process ended: its pid runs on, and its row says it is
    // over.
    ...eid == 'ended' ? { [EXIT]: {} } : {},
  })))
  let asking = {
    dir: at,
    me: 'me',
    running: (pid: number) => Promise.resolve(pid == Deno.pid),
  }
  let found = await vanished(store(g), asking)
  assertEquals(found.map((b) => b.entity.eid), ['dead'])
  let over = (eid: string) => gone(store(g), eid, asking)
  assertEquals(
    await Promise.all(
      ['dead', 'ended', 'live', 'launched', 'me', 'nobody'].map(over),
    ),
    [true, true, false, false, false, false],
  )
})

// The wrapper's `echo $code > file` creates the file empty and writes it a
// moment later; a load that stretches that moment let a read see the empty
// file and stamp a clean exit on a child that exited 3 (T-38290).
test('an exit-code file read before it is written is waited for, never read as 0', async () => {
  let g = tracked()
  let d = dir()
  await g.apply([{ entity: { eid: 'p1' }, [PROCESS]: { pid: 7002 } }])
  Deno.writeTextFileSync(`${d}/p1.code`, '')
  Deno.writeTextFileSync(`${d}/p1.pid`, '7001 7002\n')
  let running = (pid: number) => {
    if (pid == 7001) Deno.writeTextFileSync(`${d}/p1.code`, '3\n')
    return Promise.resolve(false)
  }
  let [run] = await watch(store(g), { dir: d, running })
  assertEquals(await run.done, 3)
})
