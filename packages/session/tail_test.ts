import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { ids, locked, pages, store, transcriptGraph } from './testing.ts'
import { claude } from './readers.ts'
import { callOf, pull, tail } from './tail.ts'

let c = (b: Bundle | undefined, name: string) => b?.[name] as Comp | undefined

let human = { origin: { kind: 'human' } }
let typed = (text: string, at = '2026-09-01T00:00:00.000Z') => ({
  type: 'user',
  message: { content: text },
  timestamp: at,
  ...human,
})
let reply = (...content: unknown[]) => ({
  type: 'assistant',
  message: { content },
})
let use = {
  type: 'tool_use',
  id: 'toolu_1',
  name: 'Bash',
  input: { command: 'ls' },
}
let answer = {
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a b' }],
  },
}

// A transcript file and the graph that reads it; callers choose their graph seam.
let fixture = (g: Graph = locked(store())) => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/one.jsonl`
  let log = (...lines: unknown[]) =>
    Deno.writeTextFileSync(
      path,
      lines.map((l) => typeof l == 'string' ? l : JSON.stringify(l)).join(
        '\n',
      ) + '\n',
      { append: true },
    )
  return { g, log, path, free: () => Deno.removeSync(dir, { recursive: true }) }
}
let file = async (
  body: (
    g: Graph,
    log: (...lines: unknown[]) => void,
    path: string,
  ) => Promise<void>,
) => {
  let f = fixture()
  try {
    await body(f.g, f.log, f.path)
  } finally {
    f.free()
  }
}

// Each incremental-reading case keeps its file and configured graph for the module.
let prepared = async (...lines: unknown[]) => {
  let f = fixture(transcriptGraph(pages))
  f.g.apply([{ entity: { eid: ids.run1 }, session: {} }])
  f.log(...lines)
  return { ...f, t: await tail(f.g, f.path, { session: ids.run1 }) }
}
let advancing = await prepared(typed('one'))
await pull(advancing.g, advancing.t, claude)
let unchangedCount = await pull(advancing.g, advancing.t, claude)
advancing.log(reply({ type: 'text', text: 'two' }))
let addedCount = await pull(advancing.g, advancing.t, claude)
let stopping = await prepared(typed('one'), typed('two'), typed('three'))
let stop = new AbortController()
let first = (e: Record<string, unknown>) => (stop.abort(), claude(e))
let stoppedCount = await pull(stopping.g, stopping.t, first, {
  signal: stop.signal,
})
let stoppedLine =
  (await tail(stopping.g, stopping.path, { session: ids.run1 })).line
let separate = await prepared(typed('one'), typed('two'))
await pull(separate.g, separate.t, claude)
let other = `${separate.path}.other`
Deno.writeTextFileSync(other, JSON.stringify(typed('elsewhere')) + '\n')
let otherTail = await tail(separate.g, other, { session: ids.run1 })

// A session's transcript, in entry order, as the kinds each entry wears.
let told = async (g: Graph, session: string) =>
  (await g.read(`.entry.session=${session}&.order=entry.seq&*`)).map((b) =>
    ['content', 'output', 'reasoning', 'notice', 'call', 'result']
      .filter((k) => b[k]).join('+')
  )

test('a transcript file becomes the session it names, at full depth', () =>
  file(async (g, log, path) => {
    log(
      typed('fix it'),
      reply({ type: 'thinking', thinking: 'look first' }, use),
      'not json at all',
      answer,
      reply({ type: 'text', text: 'fixed' }),
    )
    let t = await tail(g, path, { id: 'fresh' })
    assertEquals(await pull(g, t, claude, { person: ids.ada }), 5)
    let [s] = await g.read('.session.id=fresh&*')
    assertEquals(c(s, 'session')?.operator, true)
    assertEquals(await told(g, s.entity.eid), [
      'content',
      'content+output+reasoning',
      'call',
      'content+result',
      'content+output',
    ])
    let [input] = await g.read(
      `.entry.session=${s.entity.eid}&.order=entry.seq&*`,
    )
    assertEquals(c(input, 'created')?.by, ids.ada)
    assertEquals(c(input, 'created')?.at, '2026-09-01T00:00:00.000Z')
    // The call names its tool, and its result says it went through.
    let call = callOf(s.entity.eid, 'toolu_1')
    let [made] = await g.get([call])
    assertEquals(c(made, 'call')?.to, toolEid('Bash'))
    assertEquals(c(made, 'execution'), { state: 'done', by: s.entity.eid })
    let [tool] = await g.get([toolEid('Bash')])
    assertEquals(c(tool, 'tool')?.name, 'Bash')
  }))

test('human text preserves automatic openings across import and resume', async () => {
  for (
    let [session, extra, by, operator] of [
      [{ operator: false }, {}, ids.ada, false],
      [{ operator: true, source: ids.p1 }, {}, ids.ada, false],
      [{ operator: true }, { spawned: { parent: ids.run2 } }, ids.ada, false],
      [{ operator: true }, {}, ids.run2, false],
      [{}, {}, ids.run2, false],
      [{}, {}, ids.ada, true],
      [{ operator: true }, {}, 'imported', true],
    ] as const
  ) {
    await file(async (g, log, path) => {
      await g.apply([{
        entity: { eid: 'imported' },
        session: { id: 'imported', ...session },
        ...extra,
        $actor: { by },
      }])
      log(typed('first human message'))
      await pull(g, await tail(g, path, { session: 'imported' }), claude)
      let [first] = await g.get(['imported'])
      assertEquals(c(first, 'session')?.operator, operator)
      log(typed('another human message'))
      await pull(g, await tail(g, path, { session: 'imported' }), claude)
      let [resumed] = await g.get(['imported'])
      assertEquals(c(resumed, 'session')?.operator, operator)
      assertEquals(await told(g, 'imported'), ['content', 'content'])
    })
  }
})

test('a tail reads on from where the transcript stands, and never twice', async () => {
  let { g, log, path, free } = advancing
  try {
    assertEquals(unchangedCount, 0)
    assertEquals(addedCount, 1)
    // A new tail, as after a restart, starts past what the session holds.
    log(typed('three'))
    let again = await tail(g, path, { session: ids.run1 })
    assertEquals(again.line, 2)
    await pull(g, again, claude)
    assertEquals(await told(g, ids.run1), [
      'content',
      'content+output',
      'content',
    ])
  } finally {
    free()
  }
})

test('a log compressed moves its session to the new file and leaves its updated stamp', async () => {
  let { g, log, path, free } = fixture()
  log(typed('hello'))
  let t = await tail(g, path)
  await pull(g, t, claude)
  let eid = t.session!
  let updated = { at: '2026-01-01T00:00:00.000Z', by: ids.ada }
  await g.apply([{ entity: { eid }, updated }], { trusted: true, stamp: false })
  let was = c((await g.get([eid]))[0], 'session')?.transcript
  await tail(g, `${path}.zst`)
  let [s] = await g.get([eid])
  assertEquals(s.updated, updated)
  assertEquals(c(s, 'session')?.transcript != was, true)
  free()
})

test('a pull told to stop stops between lines, and the rest is read after', async () => {
  let { g, t, free } = stopping
  try {
    assertEquals(stoppedCount, 1)
    assertEquals(stoppedLine, 1)
    assertEquals(await pull(g, t, claude), 2)
    assertEquals(await told(g, ids.run1), ['content', 'content', 'content'])
  } finally {
    free()
  }
})

test('a resume starts where the log was read, whatever became of its entries', () =>
  file(async (g, log, path) => {
    log(typed('one'), reply(use), 'not json at all')
    await pull(g, await tail(g, path, { session: ids.run1 }), claude, {
      prose: true,
    })
    // The lines that made nothing, and an entry deleted since, stay read.
    let [entry] = await g.read(`.entry.session=${ids.run1}`)
    await g.apply([{ entity: { eid: entry.entity.eid }, $delete: true }])
    assertEquals((await tail(g, path, { session: ids.run1 })).line, 3)
    // A log that says nothing at all is read once, into a session of its own.
    let quiet = `${path}.quiet`
    Deno.writeTextFileSync(quiet, 'not json\n')
    await pull(g, await tail(g, quiet, { id: 'quiet' }), claude)
    let [s] = await g.read('.session.id=quiet')
    assertEquals((await tail(g, quiet, { session: s.entity.eid })).line, 1)
  }))

test('prose alone: what was typed and what the model said', () =>
  file(async (g, log, path) => {
    log(
      typed('fix it'),
      reply({ type: 'thinking', thinking: 'hmm' }, use),
      answer,
      reply({ type: 'text', text: 'fixed' }),
    )
    let t = await tail(g, path, { session: ids.run1 })
    await pull(g, t, claude, { prose: true })
    assertEquals(await told(g, ids.run1), ['content', 'content+output'])
  }))

test('a compacted summary survives a prose-only import', () =>
  file(async (g, log, path) => {
    log(
      typed('old instruction'),
      { type: 'system', subtype: 'compact_boundary' },
      {
        type: 'user',
        isCompactSummary: true,
        message: { content: 'Keep the bridge.' },
      },
      typed('Make it blue'),
    )
    await pull(g, await tail(g, path, { session: ids.run1 }), claude, {
      prose: true,
      person: ids.ada,
    })
    let rows = await g.read(`.entry.session=${ids.run1}&.order=entry.seq&*`)
    assertEquals(rows.map((b) => c(b, 'content')?.body), [
      'old instruction',
      'Keep the bridge.',
      'Make it blue',
    ])
    assertEquals(c(rows[1], 'checkpoint'), {})
    assertEquals(c(rows[1], 'created')?.by, undefined)
  }))

test('two logs of one session each keep their own entries and their own place', async () => {
  let { g, path, free } = separate
  try {
    await pull(g, otherTail, claude)
    let said = await g.read(`.entry.session=${ids.run1}&.order=entry.seq&*`)
    assertEquals(said.map((b) => c(b, 'content')?.body), [
      'one',
      'two',
      'elsewhere',
    ])
    assertEquals((await tail(g, path, { session: ids.run1 })).line, 2)
    assertEquals((await tail(g, other, { session: ids.run1 })).line, 1)
  } finally {
    free()
  }
})

for (let size of [65535, 65536, 65537, 131073]) {
  let f = await prepared('ø'.repeat(size), typed('after the boundary'))
  await pull(f.g, f.t, claude, { until: 0 })
  let resumed = await tail(f.g, f.path, { session: ids.run1 })
  let offset = resumed.at, count = await pull(f.g, resumed, claude)
  f.free()
  test(`a resumed UTF-8 transcript finds the next line past ${size} characters`, () => {
    assertEquals(offset, size * 2 + 1)
    assertEquals(count, 1)
  })
}
