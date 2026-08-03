// The reaper's predicate, in isolation. Every case here is a process that
// exists (or existed) on the box: the point is not that the sweep finds
// orphans — it is that it declines everything else, one bright line per test.

import { assert, assertEquals } from '@std/assert'
import {
  browser,
  judge,
  judgeTree,
  type Live,
  live,
  probe,
  type Proc,
  profiles,
  throwaway,
  type Tree,
  within,
  worktree,
} from './probes.ts'

let now = Date.parse('2026-07-29T12:00:00Z')
let hour = 60 * 60 * 1000

let proc = (p: Partial<Proc> & { pid: number }): Proc => ({
  comm: 'deno',
  args: [],
  cwd: '/home/yaks/.tasks/worktrees/tasks/T-1',
  gone: false,
  born: now - 4 * hour,
  ...p,
})

let nobody: Live = { sessions: new Set(), pids: [], cwds: [] }

// Nothing descends from anything unless a test says so — the real walk reads
// /proc, which a unit test must never depend on.
let alone = () => false

let verdict = (p: Proc, it = nobody, self: number[] = []) =>
  judge([p], it, self, now, 30 * 60 * 1000, alone)[0]

Deno.test('a worktree is throwaway ground; a scratchpad alone is not', () => {
  assert(worktree('/home/yaks/.tasks/worktrees/tasks/T-9722'))
  assert(worktree('/home/yaks/tasks-worktrees/tasks/T-9722'))
  assert(worktree('/home/yaks/code/tasks/.claude/worktrees/agent-a4cca'))
  assertEquals(worktree('/home/yaks/code/tasks'), false)
  // A service an operator parked in a scratchpad carries no probe marker,
  // and a bare temp directory is not a claim on it.
  let parked = proc({
    pid: 3411435,
    cwd: '/tmp/claude-1000/-home-yaks-code-tasks/4f57030e/scratchpad',
    session: 'dead-session',
  })
  assertEquals(probe(parked), false)
  assertEquals(verdict(parked).reap, false)
  // The same process pointed at a scratch graph IS a probe by construction.
  assert(probe({ ...parked, db: '/tmp/claude-1000/x/scratchpad/ptui.db' }))
})

Deno.test('the live server is invisible to the sweep', () => {
  let v = verdict(proc({ pid: 1341901, cwd: '/home/yaks/code/tasks' }))
  assertEquals(v.reap, false)
  assertEquals(v.why, 'standing in /home/yaks/code/tasks')
})

Deno.test("another venture's service is invisible too", () => {
  let v = verdict(proc({ pid: 1248322, cwd: '/home/yaks/code/ufos' }))
  assertEquals(v.reap, false)
})

Deno.test('the sweep can never reap itself or its own line', () => {
  let v = verdict(proc({ pid: 4242 }), nobody, [4242, 99, 1])
  assertEquals(v.reap, false)
  assertEquals(v.why, 'the sweep itself')
})

Deno.test('an agent is never reaped, wherever it stands', () => {
  let v = verdict(proc({ pid: 500, comm: 'claude' }))
  assertEquals(v.reap, false)
  assertEquals(v.why, 'an agent')
})

Deno.test('a probe younger than the grace period is left alone', () => {
  let v = verdict(proc({ pid: 501, born: now - 60_000 }))
  assertEquals(v.reap, false)
  assertEquals(v.why, 'younger than the grace period')
})

Deno.test('a live session keeps its probe, by id and by ground', () => {
  let it: Live = {
    sessions: new Set(['abc-123']),
    pids: [999],
    cwds: ['/home/yaks/.tasks/worktrees/tasks/T-2'],
  }
  assertEquals(verdict(proc({ pid: 502, session: 'abc-123' }), it).reap, false)
  assertEquals(
    verdict(
      proc({ pid: 503, cwd: '/home/yaks/.tasks/worktrees/tasks/T-2/src' }),
      it,
    ).reap,
    false,
  )
  // Same ground, but the session that owns it is gone.
  assertEquals(verdict(proc({ pid: 504, session: 'dead-1' }), it).reap, true)
})

Deno.test('a live session owns its scratch graph after env and ancestry are gone', () => {
  let sid = 'abc-123'
  let it = live([{ id: sid, pid: 999 }], () => 'claude')
  let server = proc({
    pid: 505,
    cwd: '/tmp/orphaned',
    db: `/tmp/claude-1000/-home-yaks-code-tasks/${sid}/scratchpad/tasks.db`,
  })
  let v = verdict(server, it)
  assertEquals(v.reap, false)
  assertEquals(v.why, `session ${sid} owns its scratch graph`)
  assertEquals(verdict(server).reap, true)
})

Deno.test("both ends of a live agent's line are spared", () => {
  let it: Live = { sessions: new Set(), pids: [999], cwds: [] }
  // A helper below the agent, and the launcher above it: descends() answers
  // one way for each, so the predicate has to ask both.
  let below = (pid: number, root: number) => pid == 505 && root == 999
  let above = (pid: number, root: number) => pid == 999 && root == 506
  for (let [pid, kin] of [[505, below], [506, above]] as const) {
    let seen = judge([proc({ pid })], it, [], now, 30 * 60 * 1000, kin)
    assertEquals(seen[0].reap, false)
    assertEquals(seen[0].why, "in a live agent's line")
  }
})

Deno.test('an agent the graph never stamped still owns its children', () => {
  let helper = proc({ pid: 567974, comm: 'codex-code-mode' })
  let agent = proc({ pid: 565363, comm: 'codex' })
  let seen = judge(
    [helper, agent],
    nobody, // no session row anywhere names this codex
    [],
    now,
    30 * 60 * 1000,
    (pid, root) => pid == 567974 && root == 565363,
  )
  assertEquals(seen.map((v) => v.reap), [false, false])
  assertEquals(seen[0].why, "in a live agent's line")
})

Deno.test("the orphans: a dead session's server and a deleted worktree", () => {
  let server = verdict(proc({
    pid: 1250755,
    cwd: '/home/yaks/.tasks/worktrees/tasks/T-9722',
    session: '980056d9-3ad1-42e3-8b1d-7bb3286791f4',
  }))
  assertEquals(server.reap, true)
  assertEquals(server.why, 'deno in /home/yaks/.tasks/worktrees/tasks/T-9722')

  let stranded = verdict(proc({
    pid: 1,
    cwd: '/home/yaks/.tasks/worktrees/tasks/S-7392',
    gone: true,
  }))
  assertEquals(stranded.reap, true)
})

Deno.test('a headless browser is judged by its port, not its cwd', () => {
  let chrome = proc({
    pid: 779465,
    comm: 'chrome',
    cwd: '/home/yaks/code/tasks',
    args: ['--headless=new', '--remote-debugging-port=9517'],
    born: now - 86 * hour,
  })
  assert(browser(chrome))
  let v = verdict(chrome)
  assertEquals(v.reap, true)
  assertEquals(v.why, 'headless browser on 9517')
  // A browser without a debugging port is somebody's browser.
  assertEquals(browser({ ...chrome, args: ['--headless=new'] }), false)
})

Deno.test('chrome helpers follow their browser, by user-data-dir', () => {
  let dir = '--user-data-dir=/tmp/com.google.Chrome.scoped_dir.QbSdFo'
  let out = judge(
    [
      proc({
        pid: 700,
        comm: 'chrome',
        cwd: '/home/yaks/code/tasks',
        args: ['--headless=new', '--remote-debugging-port=9517', dir],
      }),
      proc({
        pid: 701,
        comm: 'chrome',
        cwd: '/home/yaks/code/tasks',
        args: ['--type=renderer', dir],
      }),
      proc({
        pid: 702,
        comm: 'chrome',
        cwd: '/home/yaks/code/tasks',
        args: ['--type=gpu-process', '--user-data-dir=/tmp/somebody.else'],
      }),
      proc({ pid: 703, comm: 'chrome_crashpad_handler', cwd: '/home/yaks' }),
    ],
    nobody,
    [],
    now,
    30 * 60 * 1000,
    alone,
  )
  assertEquals(out.map((v) => v.reap), [true, true, false, true])
  assertEquals(out[1].why, `chrome helper of ${dir.slice(16)}`)
  assertEquals(out[3].why, 'crash handler with no browser left')
})

Deno.test('a crash handler survives while any browser does', () => {
  let out = judge(
    [
      proc({
        pid: 700,
        comm: 'chrome',
        cwd: '/home/yaks/code/tasks',
        args: ['--headless=new', '--remote-debugging-port=9517'],
        born: now - 60_000,
      }),
      proc({ pid: 703, comm: 'chrome_crashpad_handler', cwd: '/home/yaks' }),
    ],
    nobody,
    [],
    now,
    30 * 60 * 1000,
    alone,
  )
  assertEquals(out.map((v) => v.reap), [false, false])
})

Deno.test('liveness is the pid plus its comm, never the row', () => {
  let comm = (pid: number) => (pid == 1407412 ? 'claude' : 'nginx')
  let it = live([
    { id: 'live', cwd: '/home/yaks/code/tasks', pid: 1407412 },
    { id: 'reused', cwd: '/x', pid: 117316 }, // pid alive, but not an agent
    { id: 'never-stamped', cwd: '/y', pid: null },
  ], comm)
  assertEquals([...it.sessions], ['live'])
  assertEquals(it.pids, [1407412])
})

Deno.test('containment is a path test, never a sibling prefix match', () => {
  assert(within('/w/T-1', '/w/T-1'))
  assert(within('/w/T-1/src/db.ts', '/w/T-1'))
  assertEquals(within('/w/T-10', '/w/T-1'), false)
})

Deno.test('a worktree is pruned only when all three locks open', () => {
  let base: Tree = { path: '/w/T-1', head: 'abc', clean: true, merged: true }
  assertEquals(judgeTree(base).prune, true)
  assertEquals(judgeTree({ ...base, clean: false }).why, 'uncommitted work')
  assertEquals(
    judgeTree({ ...base, merged: false }).why,
    'not merged into main',
  )
  assertEquals(judgeTree({ ...base, busy: 'pid 9 is inside' }).prune, false)
})

// Killing a browser and leaving its profile is half a cleanup, and on a
// RAM-backed /tmp the expensive half (T-10898). These two are what decide
// which directories the sweep may remove.
Deno.test('throwaway: scaffolding under /tmp, never a real profile', () => {
  assert(throwaway('/tmp/perf-a1b2/chrome'))
  assert(throwaway('/tmp/com.google.Chrome.scoped_dir.QbSdFo'))
  assert(throwaway('/tmp/cdp-t7081'))
  // A person's browser state is not ours to delete, whoever launched it.
  assertEquals(throwaway('/home/yaks/.config/google-chrome'), false)
  assertEquals(throwaway('/home/yaks/code/tasks/profile'), false)
  // /tmp itself, and anything walking out of it, are refused not resolved —
  // this feeds a recursive delete.
  assertEquals(throwaway('/tmp'), false)
  assertEquals(throwaway('/tmp/'), false)
  assertEquals(throwaway('/tmp/../home/yaks'), false)
})

Deno.test('profiles: the reaped browsers dirs, deduped and spared-safe', () => {
  let dir = '/tmp/perf-xyz/chrome'
  let doomed = proc({
    pid: 800,
    comm: 'chrome',
    args: [
      '--headless=new',
      '--remote-debugging-port=9200',
      `--user-data-dir=${dir}`,
    ],
  })
  // Two verdicts on one dir (a browser and its helper) yield one removal.
  let helper = proc({ ...doomed, pid: 801 })
  assertEquals(
    profiles([
      { proc: doomed, reap: true, why: 'orphan' },
      { proc: helper, reap: true, why: 'helper' },
    ]),
    [dir],
  )
  // A SPARED browser keeps its profile — that is a run still in flight.
  assertEquals(profiles([{ proc: doomed, reap: false, why: 'mine' }]), [])
  // And a browser whose profile is a real one is reaped without the delete.
  let home = proc({
    ...doomed,
    args: [
      '--headless=new',
      '--remote-debugging-port=9200',
      '--user-data-dir=/home/yaks/.config/google-chrome',
    ],
  })
  assertEquals(profiles([{ proc: home, reap: true, why: 'orphan' }]), [])
})
