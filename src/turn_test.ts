// The tiny turn-hook executable durably queues lifecycle payloads without
// importing the full CLI graph or waiting for the server event loop.
import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'
import { drain, report, turnOf } from './turn.ts'

Deno.test('turnOf recognizes only turn boundaries', () => {
  assertEquals(turnOf({ hook_event_name: 'UserPromptSubmit' }), 'busy')
  assertEquals(turnOf({ hook_event_name: 'Stop' }), 'idle')
  assertEquals(turnOf({ hook_event_name: 'SessionStart' }), undefined)
})

slow('report appends and drain consumes every queued boundary', () => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/turns.jsonl`
  report({ hook_event_name: 'UserPromptSubmit', session_id: 'thread-1' }, path)
  report({ hook_event_name: 'Stop', session_id: 'thread-1' }, path)
  let turns: unknown[] = []
  drain((turn) => turns.push(turn), path)
  assertEquals(turns, [
    { sid: 'thread-1', turn: 'busy' },
    { sid: 'thread-1', turn: 'idle' },
  ])
  Deno.removeSync(dir, { recursive: true })
})

slow('drain requeues the unprocessed tail when act throws', () => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/turns.jsonl`
  for (let sid of ['a', 'b', 'c']) {
    report({ hook_event_name: 'Stop', session_id: sid }, path)
  }
  let seen: string[] = []
  try {
    drain((t) => {
      if (t.sid == 'b') throw new Error('boom')
      seen.push(t.sid)
    }, path)
  } catch { /* expected */ }
  assertEquals(seen, ['a'])
  let rest: string[] = []
  drain((t) => rest.push(t.sid), path)
  assertEquals(rest, ['b', 'c'])
  Deno.removeSync(dir, { recursive: true })
})

slow(
  'a report landing while drain processes is kept for the next drain',
  () => {
    let dir = Deno.makeTempDirSync()
    let path = `${dir}/turns.jsonl`
    report({ hook_event_name: 'Stop', session_id: 'early' }, path)
    let first: string[] = []
    // drain holds no lock while act runs, so a hook firing mid-drain appends
    // to the (already truncated) spool and survives for the next pass.
    drain((t) => {
      first.push(t.sid)
      report({ hook_event_name: 'Stop', session_id: 'late' }, path)
    }, path)
    assertEquals(first, ['early'])
    let second: string[] = []
    drain((t) => second.push(t.sid), path)
    assertEquals(second, ['late'])
    Deno.removeSync(dir, { recursive: true })
  },
)

slow('concurrent hook processes never tear or lose a line', async () => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/turns.jsonl`
  let writers = 8, each = 25
  let mod = new URL('./turn.ts', import.meta.url).pathname
  let procs = Array.from(
    { length: writers },
    (_, w) =>
      new Deno.Command(Deno.execPath(), {
        args: [
          'eval',
          `import { report } from '${mod}'
         for (let i = 0; i < ${each}; i++) {
           report({ hook_event_name: 'Stop', session_id: 'w${w}-' + i }, '${path}')
         }`,
        ],
        stdout: 'null',
        stderr: 'inherit',
      }).output(),
  )
  for (let p of await Promise.all(procs)) assertEquals(p.code, 0)
  let sids = new Set<string>()
  drain((t) => sids.add(t.sid), path) // JSON.parse throws on any torn line
  assertEquals(sids.size, writers * each)
  Deno.removeSync(dir, { recursive: true })
})

slow('drain leaves an empty spool untouched — no truncate, no fs event', () => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/turns.jsonl`
  Deno.writeTextFileSync(path, '')
  // The server's watcher re-drains on any turns.jsonl event; a truncate of an
  // already-empty spool emits one and feeds the loop. mtime moving is the
  // observable half of that write.
  let past = new Date(Date.now() - 60_000)
  Deno.utimeSync(path, past, past)
  let turns: unknown[] = []
  drain((turn) => turns.push(turn), path)
  assertEquals(turns, [])
  assertEquals(Deno.statSync(path).mtime!.getTime(), past.getTime())
  Deno.removeSync(dir, { recursive: true })
})
