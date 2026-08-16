// The managed-CLI tailer's ingest half, end to end against a temp log file and
// a :memory: db (D-16704): drain() turns each JSONL line into ordered entries
// beside the summary stamp, a re-drain (recover / --watch reload) duplicates
// nothing, a half-written line lands only once whole, and no credential enters
// an entry. Fast — the file is written by hand, the way production's tailer
// reads it; no subprocess.
import { assert, assertEquals } from '@std/assert'
import { adapters } from './adapters.ts'
import { type Change, uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
// Isolate via a temp HOME, NOT a global LOGS_DIR: Deno runs every test file in
// one shared process (no --parallel), so a top-level `LOGS_DIR` set would leak
// into later files — roles_test relies on the default `$HOME/.tasks/logs`, and
// an inherited LOGS_DIR silently pointed its managed resume at this file's dir.
// Setting HOME keeps `logsDir()` (= `$HOME/.tasks/logs`) inside this temp while
// every file that sets its own HOME (roles_test, db_test) stays unaffected.
let tmp = Deno.makeTempDirSync({ prefix: 'tasks-ingest-' })
Deno.env.set('HOME', tmp)

let { apply, db } = await import('./db.ts')
let { readEntries } = await import('./entries.ts')
let { drain, logsDir } = await import('./sessions.ts')
let { graphLog } = await import('./entry_log.ts')
let { sessionRow } = await import('./session_store.ts')

Deno.mkdirSync(logsDir(), { recursive: true })

// A managed session with a log file carrying the given already-newline-joined
// lines. Returns the session eid.
let managed = (lines: string[]) => {
  let eid = uuid()
  apply(db, [{ eid, name: 'session', comp: { id: eid, origin: 'managed' } }])
  Deno.writeTextFileSync(
    `${logsDir()}/${eid}.jsonl`,
    lines.map((l) => l + '\n').join(''),
  )
  return eid
}

let append = (eid: string, line: string) =>
  Deno.writeTextFileSync(`${logsDir()}/${eid}.jsonl`, line + '\n', {
    append: true,
  })

let tail = () => ({ at: 0, seq: 0, ended: false, errs: [] })
let cast = () => {}

// The rendered transcript rows, in order — loosely typed for terse assertions
// across the LogRow union.
let rows = (eid: string): Record<string, unknown>[] =>
  graphLog(readEntries(db, eid)).entries.flatMap((e) =>
    e.row ? [e.row as Record<string, unknown>] : []
  )
let coords = (eid: string): [unknown, unknown][] =>
  readEntries(db, eid).flatMap((e) =>
    e.comps.imported ? [[e.comps.imported.source, e.comps.imported.line]] : []
  )

let prompt = (text: string) =>
  JSON.stringify({
    type: 'session.prompt',
    text,
    timestamp: '2026-08-12T00:00:00Z',
  })
let cx = (item: unknown) => JSON.stringify({ type: 'item.completed', item })

Deno.test('managed codex history lands as ordered entries, faithful to the file', async () => {
  let eid = managed([
    prompt('do the thing'),
    cx({ id: 'i0', type: 'reasoning', text: 'planning' }),
    cx({
      id: 'i1',
      type: 'command_execution',
      command: 'ls',
      aggregated_output: 'a\nb',
      exit_code: 0,
      status: 'completed',
    }),
    cx({ id: 'i2', type: 'agent_message', text: 'done' }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
  ])
  await drain(eid, adapters.codex, tail(), cast)

  let r = rows(eid)
  assertEquals(r.map((x) => x.kind), ['say', 'reason', 'exec', 'tool', 'say'])
  assertEquals([r[0].role, r[0].text], ['user', 'do the thing'])
  assertEquals(r[2].command, 'ls')
  assertEquals(r[3].name, '↳ shell') // the correlated result names its call
  assertEquals(r[3].ok, true)
  assertEquals([r[4].role, r[4].text], ['agent', 'done'])

  // every entry wears the managed coordinate; the command line minted TWO
  // entries (call + result) that share its line number.
  let cs = coords(eid)
  assertEquals(cs.every(([s]) => s == 'managed'), true)
  assertEquals(cs.filter(([, l]) => l == 3).length, 2)

  // the summary stamp still advanced — readers depend on it until T-16824
  let s = sessionRow(db, eid)!
  assertEquals(s.latest_seq, 5)
  assertEquals(s.final_text, 'done')
})

Deno.test('re-draining from line 1 (recover / reload) duplicates nothing', async () => {
  let eid = managed([
    prompt('go'),
    cx({ id: 'i1', type: 'agent_message', text: 'first' }),
    cx({ id: 'i2', type: 'agent_message', text: 'second' }),
  ])
  await drain(eid, adapters.codex, tail(), cast)
  let before = readEntries(db, eid).map((e) => e.eid)
  assertEquals(before.length, 3)

  // recover() re-drains the whole file with a fresh Tail; skip-if-present makes
  // it a no-op, and the eids are unchanged.
  await drain(eid, adapters.codex, tail(), cast)
  let after = readEntries(db, eid).map((e) => e.eid)
  assertEquals(after, before)
})

Deno.test('a live-edge append casts its entry, so a subscriber tails through the graph', async () => {
  // Liveness (T-16824): a process-backed run's transcript is read from its
  // graph entry partition, so its live tail must reach entry subscribers the
  // same way the runner's own appends do — through cast()/maintain(). The FIRST
  // drain pass is the catch-up (history, silent); a later pass on the same live
  // Tail casts every new entry. A subscriber then never polls a file.
  let eid = managed([
    prompt('go'),
    cx({ id: 'i1', type: 'agent_message', text: 'first' }),
  ])
  let seen: Change[][] = []
  let spy = (changes: Change[]) => void seen.push(changes)
  // The summary stamp casts a `session` change every pass; the transcript rows
  // are the `content`/`message` casts, and those are what a subscriber tails.
  let entryCasts = () =>
    seen.flat().filter((c) => c.name == 'content' || c.name == 'message')
  let t = tail()
  await drain(eid, adapters.codex, t, spy) // catch-up pass — appends silently
  assertEquals(entryCasts().length, 0, 'the history catch-up cast an entry')

  append(eid, cx({ id: 'i2', type: 'agent_message', text: 'second' }))
  await drain(eid, adapters.codex, t, spy) // live edge — the new entry casts
  assert(entryCasts().length > 0, 'a live-edge append cast no entry')
  assertEquals(rows(eid).at(-1)?.text, 'second')
})

Deno.test('a half-written last line is ingested only once, whole', async () => {
  let eid = managed([prompt('start')])
  // append a complete line, then a partial one (no trailing newline yet)
  append(eid, cx({ id: 'i1', type: 'agent_message', text: 'whole' }))
  let partial = cx({ id: 'i2', type: 'agent_message', text: 'torn' })
  Deno.writeTextFileSync(`${logsDir()}/${eid}.jsonl`, partial, { append: true })

  let t = tail()
  await drain(eid, adapters.codex, t, cast)
  assertEquals(rows(eid).map((r) => r.text), ['start', 'whole']) // torn line held back

  // the newline lands; the same live Tail reads the rest and completes it
  Deno.writeTextFileSync(`${logsDir()}/${eid}.jsonl`, '\n', { append: true })
  await drain(eid, adapters.codex, t, cast)
  let texts = rows(eid).map((r) => r.text)
  assertEquals(texts, ['start', 'whole', 'torn'])
  // and no duplicate of the whole line
  assertEquals(texts.filter((x) => x == 'whole').length, 1)
})

Deno.test('a crash between a re-drain leaves multi-entry lines all-or-nothing', async () => {
  // The command line maps to call + result in ONE apply() batch, so its
  // coordinate is atomic. A re-drain (a fresh tail, as after a crash) re-reads
  // the whole file and re-adds only lines whose coordinate is absent — the
  // committed line is skipped, so no half of it is ever duplicated.
  let eid = managed([
    prompt('x'),
    cx({
      id: 'i1',
      type: 'command_execution',
      command: 'echo hi',
      aggregated_output: 'hi',
      exit_code: 0,
      status: 'completed',
    }),
  ])
  await drain(eid, adapters.codex, tail(), cast)
  let n = readEntries(db, eid).length
  assertEquals(n, 3) // user + call + result
  await drain(eid, adapters.codex, tail(), cast)
  assertEquals(readEntries(db, eid).length, 3)
})

Deno.test('a credential in a source line never reaches an entry', async () => {
  let eid = managed([
    prompt('deploy'),
    cx({
      id: 'i1',
      type: 'command_execution',
      command: 'curl -H "Authorization: Bearer sk-ant-SECRET12345token"',
      aggregated_output: 'api_key=SUPERSECRETKEYVALUE',
      exit_code: 0,
      status: 'completed',
    }),
  ])
  await drain(eid, adapters.codex, tail(), cast)
  let blob = JSON.stringify(readEntries(db, eid).map((e) => e.comps))
  assert(!blob.includes('SECRET12345'), 'the bearer token leaked')
  assert(!blob.includes('SUPERSECRETKEYVALUE'), 'the api key leaked')
  assert(blob.includes('[redacted]'), 'nothing was redacted')
})

Deno.test('managed claude tool_use correlates to its later tool_result across lines', async () => {
  let asst = (content: unknown) =>
    JSON.stringify({ type: 'assistant', message: { content } })
  let user = (content: unknown) =>
    JSON.stringify({ type: 'user', message: { content } })
  let eid = managed([
    prompt('claude go'),
    asst([{
      type: 'tool_use',
      id: 'toolu_9',
      name: 'Read',
      input: { file_path: '/x' },
    }]),
    user([{
      type: 'tool_result',
      tool_use_id: 'toolu_9',
      content: 'file body',
      is_error: false,
    }]),
    asst([{ type: 'text', text: 'read it' }]),
  ])
  await drain(eid, adapters.claude, tail(), cast)
  let r = rows(eid)
  assertEquals(r.map((x) => x.kind), ['say', 'tool', 'tool', 'say'])
  assertEquals(r[1].name, 'Read')
  assertEquals(r[2].name, '↳ Read') // the result resolved its call across two lines
})
