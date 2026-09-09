// The one thing worth pinning here is the reap's safety: it signals ONLY the
// recorded pid, and only while that pid is still our deno — so a reused pid and
// the live server (a different pid) are never touched. Everything else in
// probe_tool is a subprocess/registry side effect exercised by using the tool.

import { assertEquals } from '@std/assert'
import { copyGraph, ours, stop } from './probe_tool.ts'
import { DatabaseSync } from './store/sqlite.ts'
import { slow } from './testing.ts'

Deno.test('ours: a pid is a probe only while it is a live deno', () => {
  assertEquals(ours(42, () => 'deno'), true)
  assertEquals(ours(42, () => ''), false) // dead pid: /proc/comm reads empty
  assertEquals(ours(42, () => 'zsh'), false) // reused by something else
})

Deno.test('stop: a reused or dead pid is never signalled', async () => {
  let signalled: number[] = []
  let how = await stop(999, () => 'zsh', (p) => signalled.push(p))
  assertEquals(how, 'gone')
  assertEquals(signalled, []) // not our deno — hands off
})

Deno.test('stop: our deno gets TERM, and KILL only if it lingers', async () => {
  let sent: string[] = []
  // Alive for the first few polls, then it leaves after the TERM.
  let beats = 0
  let comm = () => beats++ < 3 ? 'deno' : ''
  let how = await stop(
    1234,
    comm,
    (_p, sig) => void sent.push(String(sig)),
    () => Promise.resolve(),
  )
  assertEquals(how, 'killed')
  assertEquals(sent, ['SIGTERM']) // gone before the KILL was needed
})

Deno.test('stop: a wedged deno keeps its scratch graph until exit is confirmed', async () => {
  let sent: string[] = []
  let how = await stop(
    1234,
    () => 'deno', // never leaves
    (_p, sig) => void sent.push(String(sig)),
    () => Promise.resolve(),
  )
  assertEquals(how, 'busy')
  assertEquals(sent, ['SIGTERM', 'SIGKILL'])
})

Deno.test('stop: waits for SIGKILL to finish before allowing graph cleanup', async () => {
  let sent: string[] = []
  let waiting = 0
  let how = await stop(
    1234,
    () => waiting < 3 ? 'deno' : '',
    (_p, sig) => void sent.push(String(sig)),
    () => {
      if (sent.includes('SIGKILL')) waiting++
      return Promise.resolve()
    },
  )
  assertEquals(how, 'killed')
  assertEquals(sent, ['SIGTERM', 'SIGKILL'])
  assertEquals(waiting, 3)
})

slow(
  'copyGraph snapshots committed WAL data with the writer still open',
  () => {
    let dir = Deno.makeTempDirSync({ prefix: 'probe-copy-' })
    let source = new DatabaseSync(`${dir}/source.db`)
    try {
      source.exec('pragma journal_mode=wal; create table item (value);')
      source.exec("insert into item values ('kept in WAL')")
      copyGraph(`${dir}/source.db`, `${dir}/copy.db`)
      let copy = new DatabaseSync(`${dir}/copy.db`)
      try {
        assertEquals(copy.prepare('select * from item').all(), [{
          value: 'kept in WAL',
        }])
        assertEquals(copy.prepare('pragma integrity_check').get(), {
          integrity_check: 'ok',
        })
        source.exec("insert into item values ('after snapshot')")
        assertEquals(copy.prepare('select count(*) as n from item').get(), {
          n: 1,
        })
      } finally {
        copy.close()
      }
    } finally {
      source.close()
      Deno.removeSync(dir, { recursive: true })
    }
  },
)
