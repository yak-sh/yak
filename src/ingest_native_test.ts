// The native interactive tailer's ingest half, end to end against fixture
// transcripts and a :memory: db (D-16704, T-16820): drainNative() turns each
// provider-owned transcript line into ordered entries beside the summary stamp,
// a re-drain (recover / restart) duplicates nothing, a native Claude transcript
// shares the managed mapper while a native Codex ROLLOUT takes its own dialect,
// and a missing/truncated/malformed source leaves a durable diagnostic without
// destroying already-ingested history. Fast — the fixture is written by hand,
// the way a provider's terminal writes it; no subprocess, no live process.
//
// A temp HOME (never a global LOGS_DIR — roles_test relies on the default logs
// dir, and a leaked LOGS_DIR would misroute it) points transcriptStores() at a
// fixture tree we own, so confined() admits our files exactly as production's.
import { assert, assertEquals } from '@std/assert'

let tmp = Deno.makeTempDirSync({ prefix: 'tasks-native-' })
Deno.env.set('HOME', tmp)
Deno.env.set('DB_PATH', ':memory:')

let { apply, db } = await import('./db.ts')
let { readEntries } = await import('./entries.ts')
let { drainNative } = await import('./sessions.ts')
let { graphLog } = await import('./entry_log.ts')
let { sessionRow } = await import('./session_store.ts')
let { uuid } = await import('./types.ts')

let claudeStore = `${tmp}/.claude/projects/proj`
let codexStore = `${tmp}/.codex/sessions/2026/08/12`
Deno.mkdirSync(claudeStore, { recursive: true })
Deno.mkdirSync(codexStore, { recursive: true })

// A native (operator-terminal) session whose durable log is the given confined
// transcript. Origin stays unset — only a managed run writes our own stdout.
let native = (provider: string, path: string, lines: string[]) => {
  let eid = uuid()
  Deno.writeTextFileSync(path, lines.map((l) => l + '\n').join(''))
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: eid, provider, transcript: path },
  }])
  return eid
}
let write = (path: string, lines: string[]) =>
  Deno.writeTextFileSync(path, lines.map((l) => l + '\n').join(''))
let appendLine = (path: string, line: string) =>
  Deno.writeTextFileSync(path, line + '\n', { append: true })

let fresh = () => ({ at: 0, seq: 0, ended: false, errs: [] })
let cast = () => {}

let rows = (eid: string): Record<string, unknown>[] =>
  graphLog(readEntries(db, eid)).entries.flatMap((e) =>
    e.row ? [e.row as Record<string, unknown>] : []
  )
let coords = (eid: string): [unknown, unknown][] =>
  readEntries(db, eid).flatMap((e) =>
    e.comps.imported ? [[e.comps.imported.source, e.comps.imported.line]] : []
  )
// The durable diagnostic lands on the session's error FACET (a separate row),
// not a session column — that is what makes it visible to user and operator.
let errorOf = (eid: string) =>
  String(
    (db.prepare('select message from error where eid = ?').get(eid) as
      | { message: string | null }
      | undefined)?.message ?? '',
  )

// ---- claude: the native transcript is the same shape the managed stream prints

let asst = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', message: { content }, ...extra })
let user = (content: unknown) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content } })

Deno.test('native claude: a whole turn lands as ordered entries, source native', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [
    user('do the thing'),
    asst([{ type: 'thinking', thinking: 'planning' }]),
    asst([{
      type: 'tool_use',
      id: 'toolu_1',
      name: 'Bash',
      input: { command: 'ls -la' },
    }]),
    user([{
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'total 0',
      is_error: false,
    }]),
    asst([{ type: 'text', text: 'all done' }]),
  ])
  await drainNative(eid, fresh(), cast)

  let r = rows(eid)
  assertEquals(r.map((x) => x.kind), ['say', 'reason', 'exec', 'tool', 'say'])
  assertEquals([r[0].role, r[0].text], ['user', 'do the thing'])
  assertEquals(r[2].command, 'ls -la')
  assertEquals(r[3].name, '↳ shell') // the result resolved its call across lines
  assertEquals(r[3].ok, true)
  assertEquals([r[4].role, r[4].text], ['agent', 'all done'])

  // every entry wears the NATIVE coordinate (not 'managed')
  let cs = coords(eid)
  assertEquals(cs.every(([s]) => s == 'native'), true)
  // the tool_use is line 3, its result line 4 — line == source line, not seq
  assertEquals(cs.find(([, l]) => l == 3)?.[0], 'native')
  assertEquals(sessionRow(db, eid)!.latest_seq, 5)
})

// ---- codex: the interactive ROLLOUT is a distinct dialect from `exec --json`

let ev = (payload: unknown) => JSON.stringify({ type: 'event_msg', payload })
let item = (payload: unknown) =>
  JSON.stringify({ type: 'response_item', payload })

Deno.test('native codex: rollout envelopes become ordered entries with correlation', async () => {
  let path = `${codexStore}/rollout-${uuid()}.jsonl`
  let eid = native('codex', path, [
    JSON.stringify({ type: 'session_meta', payload: { id: 'x' } }),
    ev({ type: 'user_message', message: 'build it' }),
    item({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'plan' }],
    }),
    // the developer instructions repeat here — must NOT become a row or leak
    item({
      type: 'message',
      role: 'developer',
      content: [{ text: 'INSTRUCTIONS' }],
    }),
    item({
      type: 'function_call',
      name: 'exec_command',
      call_id: 'call_1',
      arguments: JSON.stringify({ cmd: 'echo hi' }),
    }),
    item({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'Process exited with code 0\nOutput:\nhi',
    }),
    ev({ type: 'agent_message', message: 'finished', phase: 'final_answer' }),
    ev({ type: 'token_count', info: {} }),
  ])
  await drainNative(eid, fresh(), cast)

  let r = rows(eid)
  assertEquals(r.map((x) => x.kind), ['say', 'reason', 'exec', 'tool', 'say'])
  assertEquals([r[0].role, r[0].text], ['user', 'build it'])
  assertEquals(r[2].command, 'echo hi')
  assertEquals(r[3].name, '↳ shell') // output correlated to its call across lines
  assertEquals(r[3].ok, true)
  assertEquals([r[4].role, r[4].text], ['agent', 'finished'])

  // the developer instructions never entered the graph
  let blob = JSON.stringify(readEntries(db, eid).map((e) => e.comps))
  assert(!blob.includes('INSTRUCTIONS'), 'the instructions leaked')
  assertEquals(coords(eid).every(([s]) => s == 'native'), true)
})

// ---- restart / re-drain: the derived coordinate dedups exactly once

Deno.test('native: a restart re-drains from line 1 and duplicates nothing', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [
    user('go'),
    asst([{ type: 'text', text: 'first' }]),
  ])
  await drainNative(eid, fresh(), cast)
  let before = readEntries(db, eid).map((e) => e.eid)
  assertEquals(before.length, 2)

  // a tasksd restart drops the in-memory Tail and re-drains the whole file with
  // a fresh one; skip-if-present on (session, source, line) makes it a no-op
  await drainNative(eid, fresh(), cast)
  assertEquals(readEntries(db, eid).map((e) => e.eid), before)

  // then the session keeps talking — only the un-ingested tail lands
  appendLine(path, asst([{ type: 'text', text: 'second' }]))
  await drainNative(eid, fresh(), cast)
  assertEquals(rows(eid).map((r) => r.text), ['go', 'first', 'second'])
  // still exactly once each
  let texts = rows(eid).map((r) => r.text)
  assertEquals(texts.filter((x) => x == 'first').length, 1)
})

Deno.test('native: a live Tail resumes mid-file across drains without re-reading', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [user('one')])
  let t = fresh() // the SAME live Tail across polls (the in-memory accelerator)
  await drainNative(eid, t, cast)
  appendLine(path, asst([{ type: 'text', text: 'two' }]))
  await drainNative(eid, t, cast)
  assertEquals(rows(eid).map((r) => r.text), ['one', 'two'])
  assertEquals(coords(eid).map(([, l]) => l), [1, 2])
})

// ---- malformed / truncated / missing: durable diagnostic, history intact

Deno.test('native: a malformed line is diagnosed and stepped over, history intact', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [
    user('start'),
    '{ this is not json',
    asst([{ type: 'text', text: 'after' }]),
  ])
  await drainNative(eid, fresh(), cast)
  // the two good lines still became entries; the bad one produced none
  assertEquals(rows(eid).map((r) => r.text), ['start', 'after'])
  // the coordinate skipped the malformed line 2 (only 1 and 3 present)
  assertEquals(coords(eid).map(([, l]) => l), [1, 3])
  // and a durable, actionable diagnostic sits on the session's error facet
  let err = errorOf(eid)
  assert(err.includes('line 2') && err.includes('malformed'), err)
})

Deno.test('native: a truncated (shrunk) source is diagnosed, prior history kept', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [
    user('one'),
    asst([{ type: 'text', text: 'two' }]),
  ])
  let t = fresh()
  await drainNative(eid, t, cast)
  assertEquals(readEntries(db, eid).length, 2)

  // the provider rewrote its file shorter (rotation/truncation under us). The
  // live Tail is now past EOF; a durable diagnostic is recorded and NOTHING is
  // re-ingested from the misaligned bytes — the prior entries stand.
  write(path, [user('replaced')])
  await drainNative(eid, t, cast)
  assertEquals(readEntries(db, eid).length, 2) // no new misaligned entry
  let err = errorOf(eid)
  assert(err.includes('truncated') || err.includes('rotated'), err)
})

Deno.test('native: a source that vanishes after being read leaves a diagnostic', async () => {
  let path = `${claudeStore}/${uuid()}.jsonl`
  let eid = native('claude', path, [user('hi')])
  let t = fresh()
  await drainNative(eid, t, cast)
  assertEquals(readEntries(db, eid).length, 1)

  Deno.removeSync(path) // the transcript is gone
  await drainNative(eid, t, cast)
  assertEquals(readEntries(db, eid).length, 1) // history intact
  let err = errorOf(eid)
  assert(err.includes('gone'), err)
})
