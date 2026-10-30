// A session's process going is what ends it: `endGone` against a directory of
// running-process files and logs on disk, read back through its status.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { onDisk } from '@yaks/file/local'
import { graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { executionComputed } from '@yaks/tools'
import { modelDoc } from '@yaks/model/vocab'
import { fileDoc } from '@yaks/file/vocab'
import { machineDoc } from '@yaks/machine/vocab'
import { processDoc } from '@yaks/process/vocab'
import { sessionDoc } from './comp.ts'
import { attemptComputed } from './attempt.ts'
import { statusComputed } from './state.ts'
import { endGone, runningSessions } from './ended.ts'
import { versionOf } from './files.ts'

let root = Deno.makeTempDirSync()
let projects = `${root}/projects`, running = `${root}/sessions`
Deno.mkdirSync(projects)
Deno.mkdirSync(running)
Deno.writeTextFileSync(
  `${running}/1.json`,
  JSON.stringify({ pid: 1, sessionId: 'on' }),
)
Deno.writeTextFileSync(
  `${running}/2.json`,
  JSON.stringify({ pid: 2, sessionId: 'crashed' }),
)
Deno.writeTextFileSync(`${running}/1.abc.key`, 'not a process')
let alive = (pid: number) => Promise.resolve(pid == 1)

let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  fileDoc,
  machineDoc,
  processDoc,
])
let store = () =>
  ram(vocab, {
    computed: { ...executionComputed, ...attemptComputed, ...statusComputed },
  })
let locked = (storage: Storage) => graph({ storage, vocab })
let seed = (s: Storage, ...bundles: Bundle[]) =>
  locked(s).apply(bundles, { trusted: true })
let ids = { run1: 'run1', run2: 'run2' }

let HOUR = 3_600_000
let logs = 0
// A log last written `hours` ago, in Claude's directory or elsewhere.
let log = (hours: number, text = '{}\n', dir = projects) => {
  let path = `${dir}/${++logs}.jsonl`
  Deno.writeTextFileSync(path, text)
  let at = new Date(Date.now() - hours * HOUR)
  Deno.utimeSync(path, at, at)
  return path
}

// A session reading `running`, from a log, carrying `more`.
let session = async (
  s: Storage,
  g: Graph,
  eid: string,
  id: string,
  path: string,
  more: Bundle = { entity: { eid } },
) => {
  let [file] = await onDisk(g, path)
  await seed(
    s,
    { ...more, entity: { eid }, session: { id, transcript: file.entity.eid } },
    { ...file, transcript: { session: eid, consumed: 1 } },
    {
      entity: { eid: `${eid}-input` },
      entry: { session: eid, seq: 1 },
      content: { body: 'go' },
    },
  )
}

let ended = async (g: Graph, eid: string) =>
  ((await g.get([eid]))[0]?.session as Comp | undefined)?.ended == true

let sweep = (g: Graph) => endGone(g, { projects, running, alive })

test('a session its process no longer runs ends and reads stopped', async () => {
  let s = store(), g = locked(s)
  await session(s, g, ids.run1, 'crashed', log(3))
  await session(s, g, ids.run2, 'on', log(3))
  assertEquals(await sweep(g), [ids.run1])
  assertEquals(await ended(g, ids.run1), true)
  assertEquals(await ended(g, ids.run2), false)
  assertEquals(
    (await g.read(`.session.status=stopped .fields=entity.eid`)).map((b) =>
      b.entity.eid
    ),
    [ids.run1],
  )
  assertEquals(await sweep(g), [])
})

test('a subagent lives and dies with the session at the top of its line', async () => {
  let s = store(), g = locked(s)
  await session(s, g, 'top-on', 'on', log(3))
  await session(s, g, 'top-off', 'gone', log(3))
  await session(s, g, 'kid-on', 'a1', log(3), {
    entity: { eid: 'kid-on' },
    spawned: { parent: 'top-on' },
  })
  await session(s, g, 'kid-off', 'a2', log(3), {
    entity: { eid: 'kid-off' },
    spawned: { parent: 'top-off' },
  })
  assertEquals((await sweep(g)).sort(), ['kid-off', 'top-off'])
})

test('a claim counts as owing, whatever the transcript says', async () => {
  let s = store(), g = locked(s)
  await session(s, g, ids.run1, 'gone', log(3))
  await seed(
    s,
    {
      entity: { eid: `${ids.run1}-said` },
      entry: { session: ids.run1, seq: 2 },
      content: { body: 'done' },
      output: { source: `${ids.run1}-input` },
    },
    { entity: { eid: 'work' }, claim: { session: ids.run1 } },
  )
  assertEquals(await sweep(g), [ids.run1])
})

test('a settled session holding nothing is left as it is', async () => {
  let s = store(), g = locked(s)
  await session(s, g, ids.run1, 'gone', log(3))
  await seed(s, {
    entity: { eid: `${ids.run1}-said` },
    entry: { session: ids.run1, seq: 2 },
    content: { body: 'done' },
    output: { source: `${ids.run1}-input` },
  })
  assertEquals(await sweep(g), [])
})

test('a log just written waits for its process to list itself', async () => {
  let s = store(), g = locked(s)
  await session(s, g, ids.run1, 'new', log(0))
  assertEquals(await sweep(g), [])
})

test('no running-process directory ends nothing', async () => {
  let s = store(), g = locked(s)
  await session(s, g, ids.run1, 'gone', log(3))
  assertEquals(
    await endGone(g, { projects, running: `${root}/none`, alive }),
    [],
  )
})

test('a process file of another shape stops the pass rather than ending all', async () => {
  let dir = Deno.makeTempDirSync()
  Deno.writeTextFileSync(`${dir}/3.json`, '{"version":2}')
  let refused = await runningSessions(dir, alive).catch(() => 'refused')
  assertEquals(refused, 'refused')
})

test('a log with no process to ask about ends quiet and fully read', async () => {
  let other = Deno.makeTempDirSync()
  let s = store(), g = locked(s)
  await session(s, g, 'quiet', 'x', log(3, '{}\n', other))
  await session(s, g, 'recent', 'y', log(1, '{}\n', other))
  await session(s, g, 'unread', 'z', log(3, '{}\n{}\n', other))
  assertEquals(await sweep(g), ['quiet'])
})

test('a compressed log ends once its importer reached the end of it', async () => {
  let other = Deno.makeTempDirSync()
  let zst = (name: string) => {
    let path = `${other}/${name}.jsonl.zst`
    Deno.writeTextFileSync(path, 'compressed')
    let at = new Date(Date.now() - 3 * HOUR)
    Deno.utimeSync(path, at, at)
    return path
  }
  let s = store(), g = locked(s)
  for (let name of ['read', 'unread']) {
    let path = zst(name)
    await session(s, g, name, name, path)
    let [file] = await onDisk(g, path)
    if (name == 'read') {
      await seed(s, {
        entity: file.entity,
        transcript: { finished: versionOf(Deno.statSync(path)) },
      })
    }
  }
  assertEquals(await sweep(g), ['read'])
})

test('a managed run is ended by its exit, never by the process files', async () => {
  let s = store(), g = locked(s)
  await session(s, g, 'on', 'p1', log(3), {
    entity: { eid: 'on' },
    process: { pid: 7 },
  })
  await session(s, g, 'off', 'p2', log(3), {
    entity: { eid: 'off' },
    process: { pid: 8 },
    exit: { code: 1 },
  })
  assertEquals(await sweep(g), ['off'])
})
