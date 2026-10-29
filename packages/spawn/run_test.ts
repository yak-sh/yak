import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, type Graph, graph } from '@yaks/graph'
import { processes } from '@yaks/process'
import { onDisk } from '@yaks/file/local'
import { sessionDerived, sessions } from '@yaks/session'
import { storage } from '@yaks/sqlite'
import { stepping } from '../sqlite/testing.ts'
import { claude } from './adapters.ts'
import { asked, down, finish, follow, resume, start } from './run.ts'
import { asking, FAKE, host, launching, tracked, until } from './testing.ts'

// A log file and the run that wrote it, both already over: `follow` then does
// one pass and returns, which is the whole importer without a process.
let logged = async (lines: unknown[], code = 0) => {
  let { g } = tracked()
  let dir = Deno.makeTempDirSync({ prefix: 'spawn-' })
  await g.apply(asking('S1', 'E1', 'do it'))
  await g.apply([{
    entity: { eid: 'S1' },
    process: { pid: 1, command: 'fake' },
    exit: { code },
  }])
  Deno.writeTextFileSync(
    `${dir}/S1.out`,
    lines.map((l) => typeof l == 'string' ? l : JSON.stringify(l)).join('\n') +
      '\n',
  )
  return { g, dir, close: () => Deno.removeSync(dir, { recursive: true }) }
}

let entries = async (g: { read: (q: string) => unknown }) =>
  (await g.read('.entry&.order=entry.seq&*')) as Bundle[]

let comp = (b: Bundle | undefined, name: string) => b?.[name] as Comp

test('a request is the using on the transcript, read back as a job', async () => {
  let { g } = tracked()
  await g.apply(asking('S1', 'E1', 'fix it', { effort: 'high' }))
  assertEquals(await asked(g, 'S1'), {
    provider: 'fake',
    session: 'S1',
    model: 'fake-1',
    effort: 'high',
    instruction: 'fix it',
    ask: { to: FAKE.model, through: 'E1' },
  })
  // A transcript nobody asked a provider for is nobody's to start.
  await g.apply([{ entity: { eid: 'S2' }, session: {} }])
  assertEquals(await asked(g, 'S2'), null)
})

let alone = tracked().g
await alone.apply(asking('S1', 'E1', 'fix it', { model: undefined }))
await alone.apply([{
  entity: { eid: FAKE.provider },
  using: { model: FAKE.model },
}])

test('a request naming the provider alone runs and asks its default model', async () => {
  let job = await asked(alone, 'S1')
  assertEquals([job?.model, job?.ask], ['fake-1', {
    to: FAKE.model,
    through: 'E1',
  }])
})

test('an effort the model does not serve is refused, not launched', async () => {
  let { g } = tracked()
  await g.apply(asking('S1', 'E1', 'fix it', { effort: 'extreme' }))
  await g.apply([{
    entity: { eid: FAKE.model },
    model: { efforts: 'low medium high' },
  }])
  let said = await asked(g, 'S1').catch((e: Error) => e.message)
  assert(String(said).includes('unknown effort: extreme'), String(said))
})

test('the log becomes the transcript: one entry per line that says something', async () => {
  let { g, dir, close } = await logged([
    { type: 'system', subtype: 'init', session_id: 'abc' },
    {
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [{ type: 'text', text: 'hi' }],
        usage: { output_tokens: 3 },
      },
    },
    'Client.listTools() called but server does not advertise tools capability',
    { type: 'result', usage: { output_tokens: 3 } },
  ])
  try {
    await follow(g, 'S1', claude.read, { dir })
    let said = await entries(g)
    // The request, what it said, the model request that said it with what
    // that used, the provider's ending and the final import receipt — the
    // line that was not JSON is left in the file.
    assertEquals(said.length, 5)
    assertEquals(comp(said[1], 'content').body, 'hi')
    // Everything a provider prints is output, and the run is the session.
    assertEquals(comp(said[1], 'output').source, 'S1')
    let [file] = await onDisk(g, `${dir}/S1.out`)
    assertEquals(comp(said[1], 'lines'), { file: file.entity.eid, start: 2 })
    assertEquals(comp(said[2], 'usage').output_tokens, 3)
    assertEquals(comp(said[3], 'stop'), {})
    // The line that says what the provider calls its own thread patches the
    // session rather than becoming an entry.
    let [row] = await g.read('.session&*')
    assertEquals(comp(row, 'session').id, 'abc')
    assertEquals(await Deno.stat(`${dir}/S1.out`).catch(() => null), null)

    // The stamp is the cursor: reading the same file again imports nothing.
    await follow(g, 'S1', claude.read, { dir })
    assertEquals((await entries(g)).length, 5)
  } finally {
    close()
  }
})

test('a run that stopped talking is still over, and says so once', async () => {
  let { g, dir, close } = await logged([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
  ], 3)
  try {
    await follow(g, 'S1', claude.read, { dir })
    let said = await entries(g)
    let last = said.at(-1)!
    assertEquals(comp(last, 'stop'), {})
    assertEquals(comp(last, 'failed').reason, 'Provider exited 3')
    assertEquals(comp(last, 'content').body, 'the provider exited 3')
    // And it is written once, however often the tail is run again.
    await follow(g, 'S1', claude.read, { dir })
    assertEquals((await entries(g)).length, said.length)
  } finally {
    close()
  }
})

let said = [
  { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
  { type: 'result', usage: { output_tokens: 3 } },
]

test('a pass that fails is taken up again where the transcript stands', async () => {
  let { g, dir, close } = await logged(said)
  try {
    // The first write finds the store locked past its busy timeout.
    let locked = true
    let flaky: Graph = {
      ...g,
      apply: ((b, o) => {
        if (!locked) return g.apply(b, o)
        locked = false
        throw new Error('database is locked')
      }) as Graph['apply'],
    }
    let told: unknown[] = []
    await follow(flaky, 'S1', claude.read, {
      dir,
      poll: 1,
      report: (e) => told.push(e),
    })
    assertEquals(told.length, 1)
    let got = await entries(g)
    assertEquals(comp(got[1], 'content').body, 'hi')
    assertEquals(comp(got.at(-1), 'stop'), {})
  } finally {
    close()
  }
})

let finishing = await (async () => {
  let { g, dir, close } = await logged(said)
  await g.apply([
    { entity: { eid: 'work' }, task: {}, claim: { session: 'S1' } },
  ])
  let failed = false
  let told: unknown[] = []
  let flaky: Graph = {
    ...g,
    apply: ((rows, o) => {
      if (!failed && rows.some((b) => b.comment)) {
        failed = true
        throw new Error('database is locked')
      }
      return g.apply(rows, o)
    }) as Graph['apply'],
  }
  try {
    await follow(flaky, 'S1', claude.read, {
      dir,
      poll: 0,
      report: (error) => told.push(error),
    })
    let [report] = await g.read('.comment.target=work&*')
    return {
      errors: told.length,
      report: String(comp(report, 'doc')?.body ?? ''),
      log: await Deno.stat(`${dir}/S1.out`).catch(() => null),
    }
  } finally {
    close()
  }
})()
test('a completion write that fails is retried before the log is cleaned', () => {
  assertEquals(finishing.errors, 1)
  assert(finishing.report.includes('hi'))
  assertEquals(finishing.log, null)
})

let continuation = await (async () => {
  let { g, dir, close } = await logged(said)
  await finish(g, 'S1')
  await g.apply([
    {
      entity: { eid: 'S1' },
      session: { id: 'provider-thread' },
      brief: { text: 'The first run finished.' },
    },
    {
      entity: { eid: 'E2' },
      entry: { session: 'S1' },
      content: { body: 'Continue the work.' },
      using: FAKE,
    },
  ])
  try {
    let run = await start(g, 'S1', {
      dir,
      cwd: dir,
      adapters: { fake: claude },
      launch: launching().launch,
      signal: AbortSignal.abort(),
    })
    let [row] = await g.get(['S1'], ['brief'])
    return { run, brief: row?.brief }
  } finally {
    close()
  }
})()
test('a continued run drops its earlier final account', () => {
  assert(continuation.run)
  assertEquals(continuation.brief, undefined)
})

test('a run that ended while nobody read its log is read to its end on start-up', async () => {
  let { g, dir, close } = await logged(said)
  try {
    await resume(g, { dir, adapters: { fake: claude } })
    let got = await until(async () => {
      let e = await entries(g)
      return comp(e.at(-1), 'stop') && e
    }, 'the ending')
    assertEquals(comp(got[1], 'content').body, 'hi')
  } finally {
    close()
  }
})

// A run is watched four times a second while its transcript grows, and a
// session's computed status and cost read every entry of it.
let ENTRIES = 200
let watched = stepping()
let long = await (async () => {
  let s = storage(watched.driver, host, { derived: sessionDerived(host) })
  s.install()
  let g = graph({ storage: s, vocab: host, plugins: [sessions(), processes()] })
  await g.apply(asking('S1', 'E1', 'do it'))
  await g.apply(Array.from({ length: ENTRIES }, (_, n) => ({
    entity: { eid: `said-${n}` },
    entry: { session: 'S1' },
    content: { body: 'said' },
    output: { source: 'S1' },
  })))
  await g.apply([{
    entity: { eid: 'S1' },
    process: { pid: 1, command: 'fake' },
    exit: { code: 0 },
  }])
  return g
})()

test('a run is asked how it stands without reading its transcript', async () => {
  let before = watched.steps()
  await down(long, 'S1')
  let steps = watched.steps() - before
  assert(steps < ENTRIES, `${steps} steps`)
})

// A separate graph prepares the native exclusion scenario before assertions.
let nativeExclusion = await (async () => {
  let { g } = tracked()
  await g.apply(asking('S-native', 'E-native', 'fix it'))
  await g.apply([{ entity: { eid: 'S-native' }, native: {} }])
  let request = await asked(g, 'S-native')
  let launched = false
  let run = await start(g, 'S-native', {
    launch: () => {
      launched = true
      throw Error('wrong runner')
    },
  })
  return Object.freeze({ request, run, launched })
})()

test('native graph sessions are never launched by the outside adapter', () => {
  assertEquals(nativeExclusion.request, null)
  assertEquals(nativeExclusion.run, null)
  assertEquals(nativeExclusion.launched, false)
})
