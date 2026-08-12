// The historical backfill (T-16822), end to end against fixture sources and a
// :memory: db (D-16704): backfill() reconciles Sessions that ENDED before live
// ingestion into the same ordered entry partitions, with the same importers and
// the same derived-coordinate dedup as the live tailer — history only, never a
// summary re-stamp. It proves the exit conditions directly:
//
//   - a legacy MANAGED run renders solely from entries after one sweep
//   - a legacy NATIVE transcript (claude AND codex-rollout dialects) does too
//   - a directly-written graph-native partition is untouched
//   - a second sweep creates zero duplicates (the eid set is unchanged)
//   - a missing / malformed source leaves a durable, retryable diagnostic on the
//     session's error facet without destroying prior entries
//   - the active/live set is never touched (single-writer by scope)
//
// Fast — every source is written by hand, the way a provider writes it; no
// subprocess, no live process. A temp HOME (never a global LOGS_DIR) points both
// logsDir() and transcriptStores() at a tree we own.
import { assert, assertEquals } from '@std/assert'

let tmp = Deno.makeTempDirSync({ prefix: 'tasks-backfill-' })
Deno.env.set('HOME', tmp)
Deno.env.set('DB_PATH', ':memory:')

let { apply, db } = await import('./db.ts')
let { append, readEntries } = await import('./entries.ts')
let { backfill, logsDir } = await import('./sessions.ts')
let { graphLog } = await import('./entry_log.ts')
let { uuid } = await import('./types.ts')

Deno.mkdirSync(logsDir(), { recursive: true })
let claudeStore = `${tmp}/.claude/projects/proj`
let codexStore = `${tmp}/.codex/sessions/2026/08/12`
Deno.mkdirSync(claudeStore, { recursive: true })
Deno.mkdirSync(codexStore, { recursive: true })

let cast = () => {}
let ended = '2026-08-12T00:00:00Z'

// The lifecycle columns (status, started_at, finished_at) are server-stamped,
// not wire-writable, so apply() drops them — a test writes them straight to the
// session table, the way stamp() does at runtime.
let setCols = (eid: string, cols: Record<string, unknown>) => {
  let keys = Object.keys(cols)
  db.prepare(
    `update session set ${
      keys.map((k) => `${k} = ?`).join(', ')
    } where eid = ?`,
  ).run(...keys.map((k) => cols[k] as string), eid)
}

// A FINISHED managed run whose durable log is our own stdout file.
let managed = (lines: string[], extra: Record<string, unknown> = {}) => {
  let eid = uuid()
  apply(db, [{ eid, name: 'session', comp: { id: eid, provider: 'codex' } }])
  setCols(eid, { origin: 'managed', status: 'completed', ...extra })
  if (lines.length) {
    Deno.writeTextFileSync(
      `${logsDir()}/${eid}.jsonl`,
      lines.map((l) => l + '\n').join(''),
    )
  }
  return eid
}

// A FINISHED native (operator-terminal) session whose durable log is a confined
// provider transcript. finished_at set — recover() owns the unfinished ones.
let native = (provider: string, path: string, lines: string[]) => {
  let eid = uuid()
  Deno.writeTextFileSync(path, lines.map((l) => l + '\n').join(''))
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: eid, provider, transcript: path },
  }])
  setCols(eid, { finished_at: ended })
  return eid
}

let rows = (eid: string): Record<string, unknown>[] =>
  graphLog(readEntries(db, eid)).entries.flatMap((e) =>
    e.row ? [e.row as Record<string, unknown>] : []
  )
let coords = (eid: string): [unknown, unknown][] =>
  readEntries(db, eid).flatMap((e) =>
    e.comps.imported ? [[e.comps.imported.source, e.comps.imported.line]] : []
  )
let eids = (eid: string) => readEntries(db, eid).map((e) => e.eid)
let errorOf = (eid: string) =>
  String(
    (db.prepare('select message from error where eid = ?').get(eid) as
      | { message: string | null }
      | undefined)?.message ?? '',
  )

let prompt = (text: string) =>
  JSON.stringify({ type: 'session.prompt', text, timestamp: ended })
let cx = (item: unknown) => JSON.stringify({ type: 'item.completed', item })
let asst = (content: unknown) =>
  JSON.stringify({ type: 'assistant', message: { content } })
let user = (content: unknown) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content } })
let ev = (payload: unknown) => JSON.stringify({ type: 'event_msg', payload })
let ritem = (payload: unknown) =>
  JSON.stringify({ type: 'response_item', payload })

Deno.test('a legacy managed run renders solely from entries after one sweep', async () => {
  let eid = managed([
    prompt('do it'),
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
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5 } }),
  ])
  assertEquals(readEntries(db, eid).length, 0) // predates live ingestion

  await backfill(cast)

  let r = rows(eid)
  assertEquals(r.map((x) => x.kind), ['say', 'reason', 'exec', 'tool', 'say'])
  assertEquals([r[0].role, r[0].text], ['user', 'do it'])
  assertEquals(r[2].command, 'ls')
  assertEquals(r[4].text, 'done')
  // every entry wears the managed coordinate; the command minted call + result
  // sharing its source line (line 3).
  let cs = coords(eid)
  assertEquals(cs.every(([s]) => s == 'managed'), true)
  assertEquals(cs.filter(([, l]) => l == 3).length, 2)
})

Deno.test('a legacy native claude transcript backfills as ordered entries', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [
    user('go'),
    asst([{
      type: 'tool_use',
      id: 'toolu_1',
      name: 'Bash',
      input: { command: 'ls -la' },
    }]),
    user([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }]),
    asst([{ type: 'text', text: 'all done' }]),
  ])
  await backfill(cast)
  let r = rows(eid)
  assertEquals(r.map((x) => x.kind), ['say', 'exec', 'tool', 'say'])
  assertEquals(r[1].command, 'ls -la')
  assertEquals(r[2].name, '↳ shell') // correlated across lines
  assertEquals(coords(eid).every(([s]) => s == 'native'), true)
})

Deno.test('a legacy native codex rollout backfills through its own dialect', async () => {
  let path = `${codexStore}/rollout-${uuid()}.jsonl`
  let eid = native('codex', path, [
    ev({ type: 'user_message', message: 'build it' }),
    ritem({
      type: 'function_call',
      name: 'exec_command',
      call_id: 'c1',
      arguments: JSON.stringify({ cmd: 'echo hi' }),
    }),
    ritem({
      type: 'function_call_output',
      call_id: 'c1',
      output: 'Process exited with code 0\nhi',
    }),
    ev({ type: 'agent_message', message: 'finished' }),
  ])
  await backfill(cast)
  let r = rows(eid)
  assertEquals(r.map((x) => x.kind), ['say', 'exec', 'tool', 'say'])
  assertEquals(r[1].command, 'echo hi')
  assertEquals(r[3].text, 'finished')
})

Deno.test('a second sweep creates zero duplicates (eid set unchanged)', async () => {
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
    cx({ id: 'i2', type: 'agent_message', text: 'first' }),
  ])
  await backfill(cast)
  let first = eids(eid)
  assertEquals(first.length, 4) // user + call + result + agent

  // the default incremental pass now SKIPS this session (it holds imported
  // history), and the belt-and-suspenders full re-read re-adds nothing either.
  await backfill(cast)
  assertEquals(eids(eid), first)
  await backfill(cast, true)
  assertEquals(eids(eid), first)
})

Deno.test('a directly-written graph-native partition is left untouched', async () => {
  let eid = uuid()
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: eid, origin: 'managed', status: 'completed' },
  }])
  // a runner append: an entry with NO imported coordinate
  append(db, eid, [{ message: { role: 'agent' }, content: { body: 'native' } }])
  let before = eids(eid)
  assertEquals(before.length, 1)
  assertEquals(coords(eid).length, 0)

  await backfill(cast, true)
  assertEquals(eids(eid), before) // not re-read, not duplicated
  assertEquals(coords(eid).length, 0)
})

Deno.test('a malformed line is diagnosed and stepped over, history intact', async () => {
  let eid = managed([
    prompt('start'),
    '{ not json',
    cx({ id: 'i1', type: 'agent_message', text: 'after' }),
  ])
  await backfill(cast)
  // the two good lines became entries; the coordinate skipped the bad line 2
  assertEquals(rows(eid).map((r) => r.text), ['start', 'after'])
  assertEquals(coords(eid).map(([, l]) => l), [1, 3])
  let err = errorOf(eid)
  assert(err.includes('line 2') && err.includes('malformed'), err)
})

Deno.test('a missing managed log for a run that started is a durable gap note', async () => {
  // status completed but no log file written (the source is gone).
  let eid = managed([], { status: 'completed', started_at: ended })
  await backfill(cast)
  assertEquals(readEntries(db, eid).length, 0)
  assert(errorOf(eid).includes('managed log source is gone'), errorOf(eid))
})

Deno.test('a failed-at-launch run keeps its own reason (never overwritten)', async () => {
  // A launch that failed before starting legitimately has no log; its failure
  // is its own story, so backfill neither ingests nor overwrites it.
  let eid = managed([], { status: 'failed' })
  db.prepare('insert into error (eid, at, message) values (?, ?, ?)')
    .run(eid, ended, 'exit 127') // server-owned facet, not wire-writable
  await backfill(cast)
  assertEquals(readEntries(db, eid).length, 0)
  assertEquals(errorOf(eid), 'exit 127') // preserved
})

Deno.test('a native transcript the provider deleted leaves a durable gap note', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [user('hi')])
  Deno.removeSync(path) // the provider rotated/deleted its transcript
  await backfill(cast)
  assertEquals(readEntries(db, eid).length, 0)
  assert(errorOf(eid).includes('gone'), errorOf(eid))
})

Deno.test('a credential in a legacy source never reaches an entry', async () => {
  let eid = managed([
    prompt('deploy'),
    cx({
      id: 'i1',
      type: 'command_execution',
      command: 'curl -H "Authorization: Bearer sk-ant-SECRET12345"',
      aggregated_output: 'api_key=SUPERSECRETVALUE',
      exit_code: 0,
      status: 'completed',
    }),
  ])
  await backfill(cast)
  let blob = JSON.stringify(readEntries(db, eid).map((e) => e.comps))
  assert(!blob.includes('SECRET12345'), 'the bearer token leaked')
  assert(!blob.includes('SUPERSECRETVALUE'), 'the api key leaked')
  assert(blob.includes('[redacted]'), 'nothing was redacted')
})

Deno.test('an active managed session is never touched by backfill', async () => {
  // A live run (status running) is recover()/following()'s partition, not ours —
  // single-writer by scope. Backfill must ingest nothing for it.
  let eid = managed([
    prompt('live'),
    cx({
      id: 'i1',
      type: 'agent_message',
      text: 'mid-flight',
    }),
  ], { status: 'running' })
  await backfill(cast, true)
  assertEquals(readEntries(db, eid).length, 0)
})
