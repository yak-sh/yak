// The managed-session lifecycle against a :memory: db, a temp log dir, and
// a scratch git repo — driven the way production drives it: graph writes
// dispatched through the effect registry. A session created with a
// provider spawns, a stop_request stops, a comment resumes, a delete
// kills; the fake provider does the running. Real children only where
// only a real child will do — everything else is written to the log file
// the tailer reads, because that file IS the log.
// Static imports for the two that hold no db handle (assert must be static:
// an assertion function only narrows when it's declared, not destructured);
// db.ts and sessions.ts come in dynamically, AFTER the env below points them
// at :memory: and the temp dirs.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { existsSync } from 'node:fs'
import { type Change } from './types.ts'
import { adapters } from './adapters.ts'
import { dispatch, on, relay, trace } from './effects.ts'
import { PENDING } from './deliver.ts'
import { fakeClaude, fakeCodex } from './door_fake.ts'
import { sessionRow, writeSession } from './session_store.ts'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let tmp = Deno.makeTempDirSync({ prefix: 'tasks-sessions-' })
Deno.env.set('LOGS_DIR', `${tmp}/logs`)
Deno.env.set('WORKTREES_DIR', `${tmp}/worktrees`)
Deno.env.set('CODEX_HOME', `${tmp}/codex`)
Deno.env.set('POLL_MS', '10') // tests wait on facts, never on the clock
Deno.env.set('STOP_GRACE_MS', '1000')

let { apply, db, delta, journalOf, snapshot } = await import('./db.ts')
let { hookClaim, noticesFor, rows } = await import('./client.ts')
let { childEnv, childPath } = await import('./agent_env.ts')
let { readEntries } = await import('./entries.ts')
let { graphLog, pageEntries } = await import('./entry_log.ts')
let {
  codexPending,
  commented,
  continueSession,
  deleted,
  drainNative,
  logsDir,
  graphCodex,
  landSpawnClaim,
  prepareWorktree,
  reapLeases,
  recover,
  recoverWorktree,
  running,
  spawned,
  stopped,
  tidy,
  watched,
} = await import('./sessions.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (c: Change[]) => heard.push(...c)
let row = (eid: string) => sessionRow(db, eid)
// The readers' path in a test: a session's transcript is its graph entry
// partition rendered through graphLog (T-16798) — the same door CLI/MCP/web now
// read, no file-backed logs() projection. Pages the OUTPUT like a reader does.
let logOf = (
  eid: string,
  p: { after?: number; tail?: number; limit?: number } = {},
) => {
  let log = graphLog(readEntries(db, eid))
  return { ...log, entries: pageEntries(log.entries, p) }
}
// One rendered say's text, whatever role — for asserting a transcript line.
let sayText = (e?: { row?: unknown }) =>
  String((e?.row as { text?: unknown } | undefined)?.text ?? '')
let failure = (eid: string) =>
  (db.prepare('select message from error where eid = ?').get(eid) as
    | { message: string }
    | undefined)?.message
// The break facet's message: a failed run wears `exception`, not `error`
// (T-17081), so a genuine crash/failed-launch reads here, not through failure().
let broke = (eid: string) =>
  (db.prepare('select message from exception where eid = ?').get(eid) as
    | { message: string }
    | undefined)?.message
let spawnRow = (eid: string) =>
  db.prepare('select * from spawn where eid = ?').get(eid) as
    | Record<string, string | number | null>
    | undefined

// The same curated list server.ts registers — the tests drive the wire.
on('session', { created: spawned(cast), removed: deleted })
on('stop_request', {
  created: stopped(cast),
  sweep: { pending: PENDING('stop_request') },
})
on('comment', { created: commented(cast) })

// The relay's row fetch, as server.ts performs it at boot.
let pending = (comp: string, cond: string) =>
  db.prepare(`select * from ${comp} where ${cond}`).all() as Record<
    string,
    unknown
  >[]
// A stop_request settles into the shared delivered facet now (D-14945).
let acted = (sr: string) =>
  (db.prepare('select at from delivered where eid = ?').get(sr) as
    | { at: string | null }
    | undefined)?.at ?? null

// A graph write as the server performs it: apply, cast, dispatch. The
// returned promise is every effect the batch set off — a whole run, when
// the batch was a spawn.
let write = (changes: Change[], via?: string) => {
  let t = trace()
  let out = apply(db, changes, t, via)
  cast(out)
  return dispatch(out, t)
}

// A scratch checkout — the only place a session is ever allowed to run.
let scratch = (() => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-repo-' })
  let git = (...args: string[]) =>
    new Deno.Command('git', { args, cwd: dir, stdout: 'null', stderr: 'null' })
      .outputSync()
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${dir}/README.md`, 'scratch')
  git('add', '-A')
  git('commit', '-m', 'init')
  return dir
})()

// project(+repo) → task: the graph a spawn reads its workspace from.
let seed = (body = '', repo: string | null = scratch) => {
  let p = uid(), t = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'Scratch project' } },
    { eid: p, name: 'project', comp: {} },
    ...(repo ? [{ eid: p, name: 'repo', comp: { path: repo } }] : []),
    { eid: t, name: 'doc', comp: { title: 'Do the thing', body } },
    { eid: t, name: 'task', comp: { status: 'open', project: p } },
  ])
  return { p, t }
}

// The spawn request, as any client writes it: one session change carrying
// the request columns. `extra` overrides for the refusal cases.
let begin = (
  task: string,
  extra: Record<string, unknown> = {},
  via?: string,
) => {
  let eid = uid()
  let done = write([{
    eid,
    name: 'session',
    comp: {
      id: uid(),
      provider: 'fake',
      model: 'fake-fast',
      requested_task: task,
      ...extra,
    },
  }], via)
  return { eid, done }
}

let beginCanonical = (
  task: string,
  extra: Record<string, unknown> = {},
) => {
  let eid = uid()
  let done = write([
    {
      eid,
      name: 'session',
      comp: { id: uid(), requested_task: task },
    },
    {
      eid,
      name: 'spawn',
      comp: {
        provider: 'fake',
        model: 'fake-fast',
        ...extra,
      },
    },
  ])
  return { eid, done }
}

// A comment aimed at a session — the input path.
let say = (target: string, body: string) => {
  let c = uid()
  return [
    { eid: c, name: 'doc', comp: { title: '', body } },
    { eid: c, name: 'comment', comp: { target: target } },
  ]
}

// What the server said back on a session. refuse() writes AS the session,
// so its own `via` is what marks the reply — the same stamp that keeps it
// from re-entering commented() and refusing forever.
let refusals = (target: string) =>
  (db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     join created cr on cr.eid = c.eid
     where c.target = ? and cr.via = ?`,
  ).all(target, target) as { body: string }[]).map((c) => c.body)

// The delivery ledger: a comment wears `notified` once some ear took it.
let told = (eid: string) =>
  !!db.prepare('select 1 from notified where eid = ?').get(eid)

// A session row + log file exactly as a dead child would have left them.
let plant = (lines: string[], provider = 'fake') => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  writeSession(db, eid, {
    origin: 'managed',
    status: 'running',
    provider,
  })
  Deno.mkdirSync(logsDir(), { recursive: true })
  Deno.writeTextFileSync(log(eid), lines.map((l) => `${l}\n`).join(''))
  return eid
}
let log = (eid: string) => `${logsDir()}/${eid}.jsonl`

// Wait for something the machine does off-thread: a tail catching up, a
// child settling. The budget is deliberately generous because its only job
// is to fail instead of hanging — it is NOT an assertion about speed. These
// waits ride real subprocesses, and a loaded box stretches a 130ms settle
// past a second; a budget tight enough to catch that turns a green suite red
// at random, which trains people to re-run instead of read.
// Wait for something the machine does off-thread: a tail catching up, a
// child settling. The budget is deliberately generous because its only job
// is to fail instead of hanging — it is NOT an assertion about speed. These
// waits ride real subprocesses, and a loaded box stretches a 130ms settle
// past a second; a budget tight enough to catch that turns a green suite red
// at random, which trains people to re-run instead of read. `what` may be a
// thunk, so a wait that does time out can say which half of it stalled.
let until = async (
  fact: () => boolean,
  what: string | (() => string) = 'it',
) => {
  let deadline = Date.now() + 20_000
  do {
    if (fact()) return
    await new Promise((go) => setTimeout(go, 5))
  } while (Date.now() < deadline)
  throw new Error(
    `timed out waiting for ${typeof what == 'function' ? what() : what}`,
  )
}

let INIT = '{"type":"init","session_id":"sid-1","model":"fake-fast"}'
let RESULT =
  '{"type":"result","final_text":"first","usage":{"output_tokens":7}}'

slow(
  'child PATH is the tracked contract, task CLI leading, home expanded',
  () => {
    let bin = '/home/agent/.deno/bin'
    let path = childPath('/home/agent')
    // The task CLI leads (M-17876: the child speaks as its own session).
    assertEquals(path.startsWith(`${bin}:`), true)
    // The contract's provider + system dirs are all present, %h resolved.
    for (
      let dir of [
        '/home/agent/.local/bin',
        '/home/agent/bin',
        '/home/agent/sbin',
        '/home/linuxbrew/.linuxbrew/bin',
        '/home/linuxbrew/.linuxbrew/sbin',
        '/usr/bin',
      ]
    ) assertEquals(path.split(':').includes(dir), true)
    // No unexpanded specifier survives, and every entry is deduped.
    assertEquals(path.includes('%h'), false)
    let parts = path.split(':')
    assertEquals(parts.length, new Set(parts).size)
    // With no home, the home-relative entries drop rather than resolve to `/…`.
    let rootless = childPath('')
    assertEquals(rootless.includes('.deno/bin'), false)
    assertEquals(rootless.split(':').includes('/usr/bin'), true)
  },
)

slow('managed child environment excludes provider credentials', () => {
  let marker = `credential-${uid()}`
  let names = ['OPENAI_API_KEY', 'CODEX_HOME', 'CHATGPT_ACCOUNT_ID']
  let before = names.map((name) => Deno.env.get(name))
  try {
    for (let name of names) Deno.env.set(name, `${marker}-${name}`)
    let env = childEnv('session', '/scratch/tree')
    assertEquals(names.some((name) => name in env), false)
    assertEquals(JSON.stringify(env).includes(marker), false)
  } finally {
    for (let [i, name] of names.entries()) {
      if (before[i] == null) Deno.env.delete(name)
      else Deno.env.set(name, before[i]!)
    }
  }
})

slow(
  'a spawn the graph cannot honor is a failed session, not a 400',
  async () => {
    let { t } = seed()
    let no = seed('', null) // a project with no repo comp
    let cases: [Record<string, unknown>, RegExp][] = [
      [{ provider: 'oracle' }, /unknown provider/],
      [{ model: 'gpt-9' }, /unknown model/],
      [{ effort: 'heroic' }, /unknown effort/],
      [{ requested_task: uid() }, /no such task/],
      [{ requested_task: no.t }, /no repo/],
      // T-15352: claude offers no launch effort, so an effort on a claude spawn
      // is IGNORED — this reaches the task check and fails there ('no such
      // task'), never on 'unknown effort'. The effect twin of the door guard.
      [{
        provider: 'claude',
        model: 'haiku',
        effort: 'high',
        requested_task: uid(),
      }, /no such task/],
    ]
    for (let [extra, says] of cases) {
      let { eid, done } = begin(t, extra)
      await done
      let s = row(eid)!
      assertEquals(s.status, 'failed', JSON.stringify(extra))
      assertEquals(s.origin, 'managed')
      assertMatch(failure(eid) ?? '', says)
      let failed = journalOf(db, eid).find((entry) =>
        entry.changes.some((c) =>
          c.name == 'session' && c.comp?.status == 'failed'
        )
      )
      assert(failed?.changes.some((c) => c.name == 'error'))
    }
  },
)

slow('a new Codex spawn routes to the graph-native lifecycle', async () => {
  let { t } = seed()
  let eid = uid(), routed = 0
  apply(db, [{
    eid,
    name: 'session',
    comp: {
      id: uid(),
      provider: 'codex',
      model: 'gpt-5.6-sol',
      requested_task: t,
    },
  }])
  let pending = () =>
    !!db.prepare(`select 1 from session where eid = ? and ${codexPending}`)
      .get(eid)
  assertEquals(pending(), true)
  await spawned(cast, (got, launch) => {
    routed++
    assertEquals(got, eid)
    assertEquals(
      launch.task,
      `T-${
        (db.prepare('select num from entity where eid = ?').get(t) as {
          num: number
        }).num
      }`,
    )
    assertEquals(launch.model, 'gpt-5.6-sol')
    writeSession(db, eid, { base_revision: 'prepared' })
    let input = uid(), generation = uid()
    apply(db, [
      { eid: input, name: 'entry', comp: { session: eid } },
      { eid: input, name: 'message', comp: { role: 'user' } },
      { eid: generation, name: 'entry', comp: { session: eid } },
      {
        eid: generation,
        name: 'generation',
        comp: {
          through: input,
          provider: 'codex',
          model: 'gpt-5.6-sol',
        },
      },
    ])
    return Promise.resolve()
  })(eid, {})

  assertEquals(routed, 1)
  assertEquals(row(eid)?.origin, 'managed')
  assertEquals(row(eid)?.status, null)
  assertEquals(running.has(eid), false)
  assertEquals(pending(), false)
  assertEquals(
    db.prepare('select session from claim where eid = ?').get(t),
    { session: eid },
  )

  let legacy = uid()
  apply(db, [{
    eid: legacy,
    name: 'session',
    comp: {
      id: uid(),
      provider: 'codex',
      model: 'gpt-5.6-sol',
      requested_task: t,
    },
  }])
  writeSession(db, legacy, {
    origin: 'managed',
    status: 'running',
    pid: 123,
  })
  assertEquals(
    !!db.prepare(`select 1 from session where eid = ? and ${codexPending}`)
      .get(legacy),
    false,
  )
})

slow(
  'a taskless Codex chat launches with its document as the prompt',
  async () => {
    let eid = uid(), prompt = 'Compare these approaches\nwith examples.'
    apply(db, [
      { eid, name: 'doc', comp: { title: '', body: prompt } },
      {
        eid,
        name: 'session',
        comp: { id: uid(), provider: 'codex', model: 'gpt-5.6-sol' },
      },
    ])
    await spawned(cast, (got, launch) => {
      assertEquals(got, eid)
      assertEquals(launch.task, undefined)
      assertEquals(launch.instruction.includes(prompt), true)
      return Promise.resolve()
    })(eid, {})
    assertEquals(row(eid)?.origin, 'managed')
    assertEquals(row(eid)?.requested_task, null)
  },
)

slow('a projectless Codex task starts as a no-code graph session', async () => {
  let task = uid(), eid = uid(), routed = 0
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'Triage the graph' } },
    { eid: task, name: 'task', comp: { status: 'open' } },
    {
      eid,
      name: 'session',
      comp: {
        id: uid(),
        provider: 'codex',
        model: 'gpt-5.6-sol',
        requested_task: task,
      },
    },
  ])

  await spawned(cast, (got, launch) => {
    routed++
    assertEquals(got, eid)
    assertEquals(launch.repo, undefined)
    assertEquals(launch.tree, undefined)
    assertEquals(launch.branch, undefined)
    assertMatch(launch.instruction, /no repo-backed project/)
    assertEquals(launch.instruction.includes('task land'), false)
    return Promise.resolve()
  })(eid, {})

  assertEquals(routed, 1)
  assertEquals(row(eid)?.cwd, null)
  assertEquals(row(eid)?.branch, null)
  assertEquals(failure(eid), undefined)
  assertEquals(
    db.prepare('select session from claim where eid = ?').get(task),
    { session: eid },
  )
})

slow('a process provider names its projectless-task requirement', async () => {
  let task = uid()
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'Triage the graph' } },
    { eid: task, name: 'task', comp: { status: 'open' } },
  ])
  let { eid, done } = begin(task)
  await done
  assertMatch(
    failure(eid) ?? '',
    /T-\d+ has no project; fake requires a repo-backed project/,
  )
})

slow('Codex routing keeps both process fallback doors explicit', () => {
  assertEquals(graphCodex('codex', undefined), true)
  assertEquals(graphCodex('ollama', undefined), true)
  assertEquals(graphCodex('ollama', 'cli'), true)
  assertEquals(graphCodex('codex-cli', undefined), false)
  assertEquals(graphCodex('codex', 'cli'), false)
  assertEquals(graphCodex('claude', undefined), false)
})

slow('a stale spawn claim preserves the session that won', () => {
  let { t } = seed()
  let mine = uid(), other = uid()
  apply(db, [{ eid: mine, name: 'session', comp: { id: 'stale-mine' } }, {
    eid: other,
    name: 'session',
    comp: { id: 'stale-other' },
  }])
  let planned = hookClaim(rows(snapshot(db)), t, 'stale-mine')
  apply(db, [{ eid: t, name: 'claim', comp: { session: other } }])
  landSpawnClaim(mine, t, planned, cast)
  assertEquals(
    db.prepare('select session from claim where eid = ?').get(t),
    { session: other },
  )
  assertThrows(
    () =>
      landSpawnClaim(mine, undefined, [{
        eid: t,
        name: 'task',
        comp: { status: 'unknown' },
      }], cast),
    Error,
    'task.status',
  )
})

slow('worktree preparation adopts its matching crash remnant', async () => {
  let eid = uid(), tree = `${tmp}/replayed-${eid}`, branch = `session/${eid}`
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  let launch = {
    instruction: '',
    session_id: uid(),
    repo: { path: scratch, base_branch: 'main' },
    tree,
    branch,
    model: 'gpt-5.6-sol',
  }
  await prepareWorktree(eid, launch, cast)
  let base = row(eid)?.base_revision
  writeSession(db, eid, { base_revision: null })
  await prepareWorktree(eid, launch, cast)

  assertEquals(row(eid)?.base_revision, base)
  let found = await new Deno.Command('git', {
    cwd: tree,
    args: ['branch', '--show-current'],
    stdout: 'piped',
  }).output()
  assertEquals(new TextDecoder().decode(found.stdout).trim(), branch)
})

let gitIn = (cwd: string, ...args: string[]) =>
  new Deno.Command('git', { args, cwd, stdout: 'null', stderr: 'null' })
    .outputSync()
let gitOut = (cwd: string, ...args: string[]) =>
  new TextDecoder().decode(
    new Deno.Command('git', { args, cwd, stdout: 'piped', stderr: 'null' })
      .outputSync().stdout,
  ).trim()

slow(
  'every provider self-attributes: a worktree commit carries the trailer',
  async () => {
    let { t } = seed()
    let eid = uid(), tree = `${tmp}/trailer-${eid}`, branch = `session/${eid}`
    apply(db, [{
      eid,
      name: 'session',
      comp: { id: uid(), requested_task: t, cwd: tree, branch },
    }])
    await prepareWorktree(eid, {
      instruction: '',
      session_id: uid(),
      repo: { path: scratch, base_branch: 'main' },
      tree,
      branch,
      model: 'gpt-5.6-sol',
    }, cast)
    let { num } = db.prepare('select num from entity where eid = ?')
      .get(eid) as { num: number }
    Deno.writeTextFileSync(`${tree}/work.txt`, 'attributed\n')
    gitIn(tree, 'add', '-A')
    gitIn(tree, 'commit', '-m', 'do the thing')
    // The git-side link: `git show <sha>` names the session, no agent needed.
    assertMatch(
      gitOut(tree, 'log', '-1', '--format=%B'),
      new RegExp(`^Tasks-Session: S-${num} ${eid}$`, 'm'),
    )
    // Idempotent: a second commit stamps exactly one trailer, not two.
    Deno.writeTextFileSync(`${tree}/more.txt`, 'again\n')
    gitIn(tree, 'add', '-A')
    gitIn(tree, 'commit', '-m', 'again')
    assertEquals(
      gitOut(tree, 'log', '-1', '--format=%B').match(/Tasks-Session:/g)?.length,
      1,
    )
    // The hook is per-worktree: core.hooksPath points into this worktree's
    // own gitdir, so the shared checkout and other worktrees are untouched.
    assertMatch(
      gitOut(tree, 'config', '--worktree', '--get', 'core.hooksPath'),
      /\/tasks-hooks$/,
    )
  },
)

slow(
  'recoverWorktree regrows a reaped checkout, and no-ops a live one',
  async () => {
    let { t } = seed()
    let eid = uid(), tree = `${tmp}/gone-${eid}`, branch = `session/${eid}`
    apply(db, [{
      eid,
      name: 'session',
      comp: { id: uid(), requested_task: t, cwd: tree, branch },
    }])
    await prepareWorktree(eid, {
      instruction: '',
      session_id: uid(),
      repo: { path: scratch, base_branch: 'main' },
      tree,
      branch,
      model: 'gpt-5.6-sol',
    }, cast)
    assert(existsSync(tree))
    // A live checkout is left untouched.
    assertEquals(await recoverWorktree(eid, cast), undefined)
    // Reap it exactly as probes.prune does: worktree, then branch.
    gitIn(scratch, 'worktree', 'remove', '--force', tree)
    gitIn(scratch, 'branch', '-D', branch)
    assert(!existsSync(tree))
    // The next turn regrows it at the recorded path.
    let back = await recoverWorktree(eid, cast)
    assertEquals(back?.cwd, tree)
    assert(existsSync(tree))
    assertEquals(row(eid)?.cwd, tree)
  },
)

// The whole point of the chain: a graph-native session whose checkout was
// reaped comes back and USES LOCAL TOOLS on the next user entry — across a
// daemon restart (a fresh runner over the same graph). Without recovery,
// localTools' realPath dies on the missing directory before a tool ever runs.
slow(
  'a graph-native session recovers a reaped checkout and runs local tools',
  async () => {
    let { managedCodex } = await import('./managed_codex.ts')
    let { localTools } = await import('./harness_tools.ts')
    let { readEntries, append } = await import('./entries.ts')

    let { t } = seed()
    let eid = uid(), id = uid()
    let tree = `${tmp}/native-${eid}`, branch = `session/${eid}`
    apply(db, [{
      eid,
      name: 'session',
      comp: { id, requested_task: t, cwd: tree, branch },
    }])
    db.prepare("update session set origin = 'managed' where eid = ?").run(eid)

    // The provider: each turn asks for one shell call, then answers. `printf %s
    // "$PWD"` proves WHERE the tool ran — the regrown checkout, not a stray cwd.
    let shell = () => ({
      model: 'gpt-serving',
      items: [{
        type: 'function_call' as const,
        id: 'c',
        call_id: `call-${uid()}`,
        name: 'shell',
        arguments: JSON.stringify({
          command: 'printf %s "$PWD"',
          cwd: null,
          timeout_ms: 4000,
        }),
      }],
      unknown: [],
      unknownItems: [],
      usage: { input: 1, cached: 0, output: 1, reasoning: 0, raw: {} },
      response: {},
      limits: {},
    })
    let answer = (text: string) => ({
      ...shell(),
      items: [{
        type: 'message' as const,
        id: 'm',
        content: [{ type: 'output_text' as const, text }],
      }],
    })
    let turns = [shell(), answer('one'), shell(), answer('two')]
    let make = () =>
      managedCodex({
        db,
        cast,
        // Hermetic against a shared graph: the runner sweeps every runnable
        // session, so any OTHER session left ready by an earlier test gets a
        // plain final answer and settles, leaving this session's script intact.
        transport: {
          run: (request) =>
            Promise.resolve(
              request.prompt_cache_key == eid ? turns.shift()! : answer('idle'),
            ),
        },
        prepare: prepareWorktree,
        tools: async (into: string | undefined, session: string) => {
          await recoverWorktree(session, cast)
          return localTools({ tree: String(into) })
        },
      })

    // Turn one: a normal first run grows the checkout and runs its shell there.
    await make().start(eid, {
      instruction: 'go',
      session_id: id,
      repo: { path: scratch, base_branch: 'main' },
      tree,
      branch,
      model: 'gpt-requested',
    })
    assert(existsSync(tree))
    let real = Deno.realPathSync(tree)
    let shellOut = (session: string) =>
      readEntries(db, session).filter((r) => r.comps.result)
        .map((r) => ({ body: r.comps.content?.body, code: r.comps.exit?.code }))
    assertEquals(shellOut(eid), [{ body: real, code: 0 }])

    // Reap the clean, merged checkout, then simulate a daemon restart.
    gitIn(scratch, 'worktree', 'remove', '--force', tree)
    gitIn(scratch, 'branch', '-D', branch)
    assert(!existsSync(tree))

    // A later user entry arrives directly in the graph; the fresh runner picks
    // it up, recovers the workspace, and the shell runs in the regrown tree.
    let fresh = make()
    append(db, eid, [{
      message: { role: 'user' },
      content: { body: 'again' },
    }], fresh.runner)
    await fresh.sweep()

    assert(existsSync(tree))
    assertEquals(shellOut(eid), [
      { body: real, code: 0 },
      { body: Deno.realPathSync(tree), code: 0 },
    ])
  },
)

slow('a fake session runs end to end', async () => {
  let { t } = seed('noise') // tell the fake to write to stderr too
  let canvas = uid(), card = uid()
  apply(db, [{ eid: canvas, name: 'canvas', comp: {} }])
  heard = []
  let eid = uid(), id = uid()
  let done = write([
    {
      eid,
      name: 'session',
      comp: {
        id,
        provider: 'fake',
        model: 'fake-fast',
        effort: 'low',
        requested_task: t,
      },
    },
    // The card and pin ride the SAME batch — the client mints them, the
    // server never learns how to place a card.
    { eid: card, name: 'card', comp: { target: eid, view: 'Session' } },
    {
      eid: card,
      name: 'pin',
      comp: { canvas: canvas, x: 10, y: 20, w: 420, h: 0, z: 1 },
    },
  ])
  // Visible from its first moment: the batch itself carried the session,
  // card and pin; the effect's sync half has already stamped 'starting'.
  assert(heard.some((c) => c.eid == eid && c.name == 'session'))
  assertEquals(heard.find((c) => c.name == 'pin')?.comp?.canvas, canvas)
  assertEquals(heard.find((c) => c.name == 'card')?.comp?.view, 'Session')
  assertEquals(row(eid)?.status, 'starting')

  await done
  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.exit_code, 0)
  assertEquals(s.origin, 'managed')
  assertEquals(s.provider_session_id, s.id) // the child was told who it is
  assertEquals(s.serving_model, 'fake-fast')
  assertEquals(s.latest_seq, 5) // the prompt line, then the child's four
  assertEquals(s.requested_task, t)
  assertEquals(spawnRow(eid)?.provider, 'fake')
  assertEquals(spawnRow(eid)?.model, 'fake-fast')
  assertEquals(s.provider, 'fake') // dormant old-reader alias
  assertEquals(s.model, 'fake-fast')
  assertMatch(String(s.final_text), /^done: /)
  assertEquals(
    (db.prepare('select body from doc where eid = ?').get(eid) as {
      body: string
    }).body,
    s.final_text,
  )
  assertEquals(JSON.parse(String(s.usage_json)).output_tokens, 34)
  assertEquals(failure(eid), undefined)
  assertMatch(String(s.branch), /^session\/S-\d+$/)
  assertMatch(String(s.base_revision), /^[0-9a-f]{40}$/)
  assert(Deno.statSync(String(s.cwd)).isDirectory) // it ran in its worktree
  // The summary rode the wire as whole session comps, never as raw log.
  assert(heard.some((c) => c.name == 'session' && c.comp?.status == 'running'))

  // The transcript reads back from the session's graph entry partition — the
  // reader path (T-16798), no file-log door. Entry 1 is what we SENT: the
  // instruction, a user say (its projection/paging is ingest_drain_test's job).
  let entries = logOf(eid).entries
  let first = entries[0]
  assertEquals(first.seq, 1)
  assert(readEntries(db, eid)[0].comps.instruction)
  assertEquals(first.row?.kind, 'say')
  assertMatch(sayText(first), /T-\d+/)
  assert(entries.length > 1) // the child's turns followed
  // Paging bounds the OUTPUT (pageEntries), and stderr rides the session as a
  // bounded graph facet now — the diagnostics, unordered, off the transcript.
  assertEquals(logOf(eid, { tail: 1 }).entries.length, 1)
  assertEquals(logOf(eid, { after: 999 }).entries, [])
  assertMatch(String(row(eid)?.stderr), /stderr noise/)
})

slow('both Codex rollback names run through process JSONL', async () => {
  let oldCodex = adapters.codex
  let oldFallback = adapters['codex-cli']
  let oldMode = Deno.env.get('TASKS_CODEX_RUNNER')
  let routed = 0
  try {
    adapters.codex = adapters.fake
    adapters['codex-cli'] = adapters.fake
    for (let provider of ['codex-cli', 'codex']) {
      if (provider == 'codex') Deno.env.set('TASKS_CODEX_RUNNER', 'cli')
      let { t } = seed()
      let eid = uid()
      apply(db, [{
        eid,
        name: 'session',
        comp: {
          id: uid(),
          provider,
          model: 'fake-fast',
          requested_task: t,
        },
      }])
      await spawned(cast, () => {
        routed++
        return Promise.resolve()
      })(eid, {})
      assertEquals(row(eid)?.status, 'completed')
      assertEquals(spawnRow(eid)?.provider, provider)
      // The process JSONL path now ALSO ingests its transcript as entries
      // (T-16823) — but every one wears `imported` (file history), so the
      // session stays process-backed: no runner-minted entry, never handed to
      // the graph runner, and its log still reads from the file.
      let ents = db.prepare(
        `select i.eid as imported from entry e
         left join imported i on i.eid = e.eid where e.session = ?`,
      ).all(eid) as { imported: string | null }[]
      assert(ents.length > 0) // the transcript was ingested
      assertEquals(ents.filter((e) => !e.imported).length, 0) // all imported
      assertEquals(logOf(eid).entries.length > 1, true)
    }
    assertEquals(routed, 0)
  } finally {
    adapters.codex = oldCodex
    adapters['codex-cli'] = oldFallback
    if (oldMode == null) Deno.env.delete('TASKS_CODEX_RUNNER')
    else Deno.env.set('TASKS_CODEX_RUNNER', oldMode)
  }
})

slow(
  'a unified operator (role comp on the project) launches in its own repo, actor = itself',
  async () => {
    // The role comp sits ON the project with NO scope — the project IS its own
    // operator (D-19459). The launch must resolve the workspace to the project's
    // own repo (scope defaults to self) and stamp actor = the project entity.
    let project = uid(), eid = uid(), id = uid()
    let done = write([
      { eid: project, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: project, name: 'project', comp: {} },
      {
        eid: project,
        name: 'repo',
        comp: { path: scratch, base_branch: 'main' },
      },
      {
        eid: project,
        name: 'role',
        comp: { state: 'running', surface: 'managed' },
      },
      {
        eid,
        name: 'session',
        comp: {
          id,
          provider: 'fake',
          model: 'fake-fast',
          role: project,
          operator: 1,
        },
      },
    ])
    await done
    assertEquals(row(eid)?.status, 'completed', JSON.stringify(row(eid)))
    assertEquals(row(eid)?.actor, project) // actor = role = project, one entity
    assertEquals(row(eid)?.cwd != null, true) // launched with a worktree
    assertEquals(failure(eid), undefined)
  },
)

slow(
  'a managed role runs in its project and resumes content-free',
  async () => {
    let project = uid(), role = uid(), eid = uid(), id = uid()
    let done = write([
      { eid: project, name: 'doc', comp: { title: 'Project', body: '' } },
      { eid: project, name: 'project', comp: {} },
      {
        eid: project,
        name: 'repo',
        comp: { path: scratch, base_branch: 'main' },
      },
      {
        eid: role,
        name: 'doc',
        comp: { title: 'Coordinator', body: 'report-role-env' },
      },
      {
        eid: role,
        name: 'role',
        comp: { state: 'running', surface: 'managed', scope: project },
      },
      {
        eid,
        name: 'session',
        comp: {
          id,
          provider: 'fake',
          model: 'fake-fast',
          role: role,
          operator: 1,
        },
      },
    ])
    await done
    assertEquals(row(eid)?.status, 'completed', JSON.stringify(row(eid)))
    assertEquals(row(eid)?.actor, project)
    assertEquals(row(eid)?.requested_task, null)
    let events = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
    assert(
      events.some((line) => line.includes(`"text":"role:${role}"`)),
    )

    await continueSession(
      eid,
      'You have pending Tasks messages. Call task_context now.',
      cast,
    )
    assertEquals(row(eid)?.status, 'completed')
    let inputs = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; text?: string })
      .filter((event) => event.type == 'session.input')
    assertEquals(
      inputs.at(-1)?.text,
      'You have pending Tasks messages. Call task_context now.',
    )
  },
)

slow('a canonical fake session dual-materializes and runs', async () => {
  let { t } = seed()
  let { eid, done } = beginCanonical(t, { effort: 'high' })
  await done
  assertEquals(row(eid)?.status, 'completed')
  assertEquals(row(eid)?.provider, 'fake')
  assertEquals(row(eid)?.model, 'fake-fast')
  assertEquals(row(eid)?.effort, 'high')
  assertEquals(spawnRow(eid)?.provider, 'fake')
  assertEquals(spawnRow(eid)?.model, 'fake-fast')
  assertEquals(spawnRow(eid)?.effort, 'high')
  assertEquals(
    db.prepare('select cwd from worktree where eid = ?').get(eid),
    { cwd: String(row(eid)?.cwd) },
  )
  assertEquals(
    db.prepare('select provider_session_id from runtime where eid = ?')
      .get(eid),
    { provider_session_id: String(row(eid)?.id) },
  )
  assert(logOf(eid).entries.length > 1)
})

slow('an external provider patch is not a launch request', async () => {
  let eid = uid()
  await write([{
    eid,
    name: 'session',
    comp: { id: uid(), cwd: scratch },
  }])
  assertEquals(spawnRow(eid)?.provider, null)
  await write([{
    eid,
    name: 'session',
    comp: { provider: 'fake', model: 'fake-fast' },
  }])
  assertEquals(spawnRow(eid)?.provider, 'fake')
  assertEquals(row(eid)?.origin, 'external')
  assertEquals(row(eid)?.status, null)
  assertEquals(logOf(eid).entries, [])
})

slow('a worn persona rides the prompt whole — tiers and all', async () => {
  let { t } = seed()
  let per = uid(), mem = uid()
  apply(db, [
    { eid: per, name: 'doc', comp: { title: 'probe', body: 'Be terse.' } },
    { eid: per, name: 'persona', comp: {} },
    { eid: mem, name: 'doc', comp: { title: 'lesson', body: 'Front door.' } },
    {
      eid: per,
      name: 'dependency',
      comp: { type: 'contains', child: mem },
    },
  ])
  let { eid, done } = begin(t, { persona: per })
  await done
  assert(readEntries(db, eid)[0].comps.instruction)
  let text = sayText(logOf(eid, { limit: 1 }).entries[0])
  // The persona's OWN body describes it to graph readers, not the prompt —
  // prompt content rides via contained memories (de1bd7f). So 'Be terse.'
  // (per's description) stays OUT, while the contained memory rides whole.
  assertNotMatch(text, /Be terse\./)
  assertMatch(text, /---\n\n# D-\d+ lesson/)
  assertMatch(text, /Front door\./)
  assertNotMatch(text, /House rules for this run/)
})

slow('a bare spawn wears the project common persona (T-12867)', async () => {
  let { p, t } = seed()
  // The project's COMMON persona: home==p AND p `contains` it. It contains a
  // memory, since materialize renders contained memories, not the body itself.
  let per = uid(), mem = uid()
  apply(db, [
    { eid: per, name: 'doc', comp: { title: 'common', body: 'desc' } },
    { eid: per, name: 'persona', comp: { home: p } },
    {
      eid: mem,
      name: 'doc',
      comp: { title: 'house lore', body: 'Wear the voice.' },
    },
    { eid: p, name: 'dependency', comp: { type: 'contains', child: per } },
    { eid: per, name: 'dependency', comp: { type: 'contains', child: mem } },
  ])
  let { eid, done } = begin(t) // no --persona
  await done
  let text = sayText(logOf(eid, { limit: 1 }).entries[0])
  assertMatch(text, /# D-\d+ house lore/)
  assertMatch(text, /Wear the voice\./)
})

slow('a child that exits nonzero failed, whatever it said', async () => {
  let { t } = seed('fail:3')
  let { eid, done } = begin(t)
  await done
  assertEquals(row(eid)?.status, 'failed') // it printed a result anyway
  assertEquals(row(eid)?.exit_code, 3)
})

// The launcher's refusals are all SILENT — it backgrounds systemd-run and
// exits 0 — so the only witness is the stderr file and the pidfile that
// never appeared. Shadowing systemd-run with a refusal replays the whole
// class (a scope name still held, an unreachable user bus) exactly. The child
// PATH is the tracked contract, led by `$HOME/.deno/bin` (T-16728,
// agent_env.ts) — NOT the launcher's own PATH — so the shadow rides a tmp HOME
// whose .deno/bin holds the refusing binary.
slow(
  'a launch that never starts is stillborn, and says what refused',
  async () => {
    let { t } = seed()
    let home = Deno.env.get('HOME')!
    let fakeHome = `${tmp}/stillborn-home`
    Deno.mkdirSync(`${fakeHome}/.deno/bin`, { recursive: true })
    Deno.writeTextFileSync(
      `${fakeHome}/.deno/bin/systemd-run`,
      '#!/bin/sh\necho "Failed to start transient scope unit: ' +
        'Unit already exists." >&2\nexit 1\n',
    )
    Deno.chmodSync(`${fakeHome}/.deno/bin/systemd-run`, 0o755)
    Deno.env.set('HOME', fakeHome)
    Deno.env.set('BIRTH_GRACE_MS', '400')
    let eid: string
    try {
      let run = begin(t)
      eid = run.eid
      await run.done
    } finally {
      Deno.env.set('HOME', home)
      Deno.env.delete('BIRTH_GRACE_MS')
    }
    let s = row(eid)!
    assertEquals(s.status, 'failed')
    assertEquals(s.exit_code, null)
    // Not 'the wrapper died before reporting': no wrapper ever ran to die.
    assertMatch(String(s.stop_reason), /^stillborn/)
    // A stillborn launch is a genuine break → the `exception` facet (T-17081).
    assertMatch(broke(eid) ?? '', /transient scope unit/)
    assertEquals(failure(eid), undefined)
  },
)

// A run that exits 0 but never emits its terminal event failed (no
// completion was signalled), and the reason it broke lives only on stderr —
// the provider's dying words, like Codex's `tool call output is missing`
// loop when a tool process vanishes mid-call. A failed session must say WHY,
// so the stderr tail becomes its error rather than an empty string.
slow(
  'a run that exits clean but never finished says why from stderr',
  async () => {
    let { t } = seed('quiet noise')
    let { eid, done } = begin(t)
    await done
    assertEquals(row(eid)?.status, 'failed')
    assertEquals(row(eid)?.exit_code, 0) // clean OS exit, unfinished work
    // Failed without a terminal event is a break → `exception` (T-17081).
    assertMatch(broke(eid) ?? '', /stderr noise/)
  },
)

// The settle broadcast: whoever holds the task hears the ending on the
// bus, because the ending IS a comment on the task, via the
// session — cast like any wire write, exactly once per settle.
let settleComments = (task: string, via: string) =>
  (db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     join created b on b.eid = c.eid
     where c.target = ? and b.via = ?`,
  ).all(task, via) as { body: string }[]).map((c) => c.body)

// A lease lapse is machinery, not speech (D-13858): it lands as a NOTICE on
// the task, not a comment — same target, same instrument, off the thread.
let settleNotices = (task: string, via: string) =>
  (db.prepare(
    `select d.body from notice n join doc d on d.eid = n.eid
     join created b on b.eid = n.eid
     where n.target = ? and b.via = ?`,
  ).all(task, via) as { body: string }[]).map((c) => c.body)

slow('a settled session says so on its task', async () => {
  let { t } = seed()
  heard = []
  let { eid, done } = begin(t)
  await done
  assertEquals(row(eid)?.status, 'completed')
  let said = settleComments(t, eid)
  assertEquals(said.length, 1)
  assertMatch(said[0], /^S-\d+ completed · exit 0\n/)
  assertMatch(said[0], /done: /) // the final text's gist rides along
  assert(!said[0].includes('UNLANDED'))
  assertEquals(failure(eid), undefined)
  // The comment rode the CAST — clients heard graph data, not a stamp.
  assert(
    heard.some((c) => c.name == 'comment' && c.comp?.target == t),
  )
})

slow(
  'a completed session reports and stamps its unlanded commits',
  async () => {
    let verdict = 'project gate failed with exit 7'
    let body = `delay:300 ${'context '.repeat(80)}${verdict}`
    let { t } = seed(body)
    heard = []
    let { eid, done } = begin(t)
    await until(() => row(eid)?.status == 'running', 'the init event')
    let tree = String(row(eid)?.cwd)
    Deno.writeTextFileSync(`${tree}/unlanded.txt`, 'committed\n')
    let git = (...args: string[]) =>
      new Deno.Command('git', {
        args,
        cwd: tree,
        stdout: 'null',
        stderr: 'null',
      }).outputSync()
    assert(git('add', 'unlanded.txt').success)
    assert(git('commit', '-m', 'leave work unlanded').success)
    await done

    let branch = String(row(eid)?.branch)
    let message = failure(eid) ?? ''
    assertMatch(
      message,
      new RegExp(`^UNLANDED: 1 commit on ${branch} not in main`),
    )
    assertMatch(message, new RegExp(`${verdict}$`))
    let said = settleComments(t, eid)
    assertEquals(said.length, 1)
    assertMatch(
      said[0],
      new RegExp(`⚠ UNLANDED: 1 commit on ${branch} not in main`),
    )
    assertMatch(said[0], new RegExp(`${verdict}$`))
    assert(heard.some((c) => c.eid == eid && c.name == 'error'))
    // The commit self-attributes: the trailer is in the message (git-side)
    // and its sha rides the settle comment (graph-side) → `task search <sha>`.
    let sha = gitOut(tree, 'log', '-1', '--format=%h')
    assertStringIncludes(
      gitOut(tree, 'log', '-1', '--format=%B'),
      'Tasks-Session: S-',
    )
    assertMatch(said[0], new RegExp(`commits: ${sha}`))
  },
)

slow(
  'a failed spawn tells its task and its spawner — and only once',
  async () => {
    let { t } = seed()
    let spawner = uid(), sid = uid()
    apply(db, [{ eid: spawner, name: 'session', comp: { id: sid } }])
    heard = []
    let { eid, done } = begin(t, { model: 'no-such-model' }, sid)
    await done
    assertEquals(row(eid)?.status, 'failed')
    let said = settleComments(t, eid)
    assertEquals(said.length, 1)
    assertMatch(said[0], /^S-\d+ failed\n/)
    assertMatch(said[0], /unknown model/)
    assertEquals(settleComments(spawner, eid), said)
    assertEquals(
      (db.prepare('select via from created where eid = ?').get(eid) as {
        via: string
      }).via,
      spawner,
    )
    assert(
      heard.some((c) => c.name == 'comment' && c.comp?.target == spawner),
    )
    let bus = noticesFor(snapshot(db), sid)
    assertEquals(bus.lines.length, 1)
    assertMatch(bus.lines[0], /S-\d+ failed/)
    spawned(cast)(eid, { provider: 'fake' })
    assertEquals(settleComments(t, eid).length, 1)
    assertEquals(settleComments(spawner, eid).length, 1)
  },
)

slow('a client-launched session reports only on its task', async () => {
  let { t } = seed()
  let client = uid()
  apply(db, [{
    eid: client,
    name: 'client',
    comp: { user_agent: 'test' },
  }])
  let { eid, done } = begin(t, { model: 'no-such-model' }, client)
  await done
  assertEquals(
    (db.prepare('select via from created where eid = ?').get(eid) as {
      via: string
    }).via,
    client,
  )
  assertEquals(settleComments(t, eid).length, 1)
  assertEquals(settleComments(client, eid), [])
})

slow(
  'a settling session releases its leases — a live one keeps its own',
  async () => {
    let { t } = seed()
    let { t: kept } = seed()
    let eid = plant([INIT]) // died before its terminal event → failed
    let live = uid()
    apply(db, [
      { eid: live, name: 'session', comp: { id: uid() } },
      { eid: t, name: 'claim', comp: { session: eid } },
      { eid: kept, name: 'claim', comp: { session: live } },
    ])
    heard = []
    recover(cast)
    await running.get(eid)!.done
    assertEquals(row(eid)?.status, 'failed')
    // The dead session's lease is gone and the lapse is a NOTICE on the task's
    // trail (D-13858) — the same words task wrap leaves for an interactive end.
    assertEquals(
      db.prepare('select 1 from claim where eid = ?').get(t),
      undefined,
    )
    let said = settleNotices(t, eid)
    assertEquals(said.length, 1)
    assertMatch(said[0], /lease lapsed/)
    // The release rode the CAST — no client cache keeps the ghost claim.
    assert(heard.some((c) => c.eid == t && c.name == 'claim' && c.comp == null))
    // The bystander's lease is not ours to lapse.
    assert(db.prepare('select 1 from claim where eid = ?').get(kept))
  },
)

slow(
  'stop: a stop_request signals the group, the ending is OBSERVED',
  async () => {
    let { t } = seed('delay:9000')
    let { eid, done } = begin(t)
    await until(() => row(eid)?.status == 'running', 'the init event')
    let c0 = snapshot(db).cursor ?? 0
    heard = []
    let sr = uid()
    await write([{ eid: sr, name: 'stop_request', comp: { target: eid } }])
    let s = row(eid)!
    assertEquals(s.status, 'interrupted') // never stamped before the exit
    assert(s.stop_requested_at)
    assertEquals(s.exit_code, 143) // SIGTERM, from a child that was ours
    let stopping: Change = {
      eid,
      name: 'session',
      comp: {
        status: 'stopping',
        stop_requested_at: s.stop_requested_at,
      },
    }
    let isStopping = (c: Change) =>
      c.eid == eid && c.name == 'session' && c.comp?.status == 'stopping'
    assertEquals(heard.filter(isStopping), [stopping])
    assertEquals(delta(db, c0).changes.filter(isStopping), [stopping])
    // The request stays as audit, settled delivered when the signals were sent.
    assert(acted(sr))
    await done
    // An interruption we ASKED for is normal machinery, never a break: the
    // `interrupted` status is the whole truth, so neither health facet is stamped
    // (T-17081) — nothing for self-healing to fix.
    assertEquals(broke(eid), undefined)
    assertEquals(failure(eid), undefined)
    // A second pull on a settled session bounces off the RULE.
    assertThrows(
      () =>
        apply(db, [
          { eid: uid(), name: 'stop_request', comp: { target: eid } },
        ]),
      Error,
      'stop_request refused',
    )
  },
)

slow('sweep: an unacted stop_request re-fires at boot and kills', async () => {
  let { t } = seed('delay:9000')
  let { eid, done } = begin(t)
  await until(() => row(eid)?.status == 'running', 'the init event')
  // The crash window, reproduced: the request COMMITS (the rule passes —
  // the target is running) but its effect never fires.
  let sr = uid()
  cast(apply(db, [
    { eid: sr, name: 'stop_request', comp: { target: eid } },
  ]))
  assertEquals(acted(sr), null)
  // Boot: the relay finds it and drives the stop to an observed ending.
  assertEquals((await relay(pending)).length, 1)
  let s = row(eid)!
  assertEquals(s.status, 'interrupted')
  assertEquals(s.exit_code, 143)
  assert(acted(sr))
  await done
  // A second pass finds nothing pending — acted requests never re-fire.
  assertEquals((await relay(pending)).length, 0)
})

slow(
  'sweep: a target that settled on its own is acted, not errored',
  async () => {
    let { t } = seed('delay:500')
    let { eid, done } = begin(t)
    await until(() => row(eid)?.status == 'running', 'the init event')
    let sr = uid()
    cast(apply(db, [
      { eid: sr, name: 'stop_request', comp: { target: eid } },
    ]))
    await done // the child finishes on its own; the request outlives the run
    assertEquals(row(eid)!.status, 'completed')
    heard = []
    let c0 = snapshot(db).cursor ?? 0
    await relay(pending)
    assert(acted(sr)) // nothing to stop IS acted
    let s = row(eid)!
    assertEquals(s.status, 'completed') // never re-stamped, never 'lost'
    assertEquals(s.exit_code, 0)
    let session = (c: Change) => c.eid == eid && c.name == 'session'
    assertEquals(heard.filter(session), [])
    assertEquals(delta(db, c0).changes.filter(session), [])
  },
)

slow('the rule refuses sessions that are not ours to end', () => {
  let ext = uid()
  apply(db, [{ eid: ext, name: 'session', comp: { id: 'announced' } }])
  assertThrows(
    () =>
      apply(db, [
        { eid: uid(), name: 'stop_request', comp: { target: ext } },
      ]),
    Error,
    'external',
  )
  assertThrows(
    () =>
      apply(db, [
        { eid: uid(), name: 'stop_request', comp: { target: uid() } },
      ]),
    Error,
    'gone',
  )
})

slow('deleting a running session takes its process with it', async () => {
  let { t } = seed('delay:9000')
  let { eid, done } = begin(t)
  await until(() => row(eid)?.status == 'running', 'the init event')
  let pid = Number(
    Deno.readTextFileSync(`${logsDir()}/${eid}.pid`).trim().split(/\s+/).pop(),
  )
  let alive = () =>
    new Deno.Command('kill', {
      args: ['-0', String(pid)],
      stdout: 'null',
      stderr: 'null',
    }).outputSync().success
  await write([{ eid, name: 'entity', comp: null }])
  await until(() => !alive(), 'the child to die')
  assert(!running.has(eid)) // nothing left to follow
  assertThrows(() => Deno.statSync(`${logsDir()}/${eid}.pid`)) // or adopt
  await done // the orphaned tailer settles without a row to stamp
})

slow(
  'boot: a child that died while we were away is read from its file',
  async () => {
    let eid = plant([INIT, '{"type":"message","text":"hi"}', RESULT])
    recover(cast)
    await running.get(eid)!.done
    let s = row(eid)!
    assertEquals(s.status, 'completed')
    assertEquals(s.latest_seq, 3)
    assertEquals(s.final_text, 'first')
    assertEquals(JSON.parse(String(s.usage_json)).output_tokens, 7)
    assertEquals(s.exit_code, null) // we didn't spawn it: nobody's to read
    assertMatch(String(s.stop_reason), /unobserved/)
  },
)

slow('an unavailable land verdict preserves the source refusal', async () => {
  let eid = plant([INIT, RESULT])
  let message = 'UNLANDED: 1 commit on lost-branch not in main — gate red'
  db.prepare('insert into error (eid, at, message) values (?, ?, ?)')
    .run(eid, new Date().toISOString(), message)
  recover(cast)
  await running.get(eid)!.done
  assertEquals(row(eid)?.status, 'completed')
  assertEquals(failure(eid), message)
})

slow('boot: external transcripts restore model facts missed at startup', () => {
  let eid = uid()
  let path = `${stores.claude}/${uid()}.jsonl`
  Deno.mkdirSync(stores.claude, { recursive: true })
  Deno.writeTextFileSync(
    path,
    JSON.stringify({
      type: 'assistant',
      effort: 'high',
      message: { model: 'claude-sonnet-5' },
    }) + '\n',
  )
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: uid(), cwd: scratch, transcript: path },
  }])
  db.prepare('update session set finished_at = ? where eid = ?')
    .run('2026-07-27T16:07:22.782Z', eid)

  heard = []
  recover(cast)

  assertEquals(row(eid)?.provider, 'claude')
  assertEquals(row(eid)?.serving_model, 'claude-sonnet-5')
  assertEquals(row(eid)?.effort, 'high')
  assert(heard.some((c) =>
    c.eid == eid && c.name == 'session' &&
    c.comp?.serving_model == 'claude-sonnet-5'
  ))
})

slow('a settled lifecycle stamp is one replayable moved patch', async () => {
  let eid = plant([])
  let c0 = snapshot(db).cursor ?? 0
  heard = []
  recover(cast)
  await running.get(eid)!.done

  let rows = db.prepare(
    'select batch from journal where rowid > ? order by rowid',
  ).all(c0) as { batch: string }[]
  assertEquals(rows.length, 1)
  let changes = JSON.parse(rows[0].batch) as Change[]
  assertEquals(changes, [{
    eid,
    name: 'session',
    comp: {
      status: 'failed',
      stop_reason: 'exit unobserved: the child outlived the server',
      finished_at: row(eid)?.finished_at,
    },
  }])
  assertEquals(
    heard.filter((c) => c.eid == eid && c.name == 'session'),
    changes,
  )
  assertEquals(
    delta(db, c0).changes.filter((c) => c.name == 'session'),
    changes,
  )
})

slow('tail diagnoses never override a successful ending', async () => {
  let eid = plant([
    INIT,
    '{"type":"message", this is not json',
    RESULT,
    JSON.stringify({ type: 'message', text: 'x'.repeat(1_100_000) }),
    '{"type":"result","final_text":"second"}',
  ])
  recover(cast)
  await running.get(eid)!.done
  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.final_text, 'first') // the late result never lands
  assertEquals(s.latest_seq, 5) // every line counted, none skipped
  assertMatch(failure(eid) ?? '', /line 2: malformed/)
  assertMatch(failure(eid) ?? '', /line 4: truncated \(1100028 bytes/)
  assertMatch(failure(eid) ?? '', /line 5: output after the terminal event/)
})

slow('an oversized line is truncated and the tail reaches exit 0', async () => {
  let huge = JSON.stringify({ type: 'message', text: 'x'.repeat(1_100_000) })
  let eid = plant([
    INIT,
    huge,
    '{"type":"message","text":"after"}',
    '{"type":"result","final_text":"done after truncation"}',
  ])
  Deno.writeTextFileSync(`${logsDir()}/${eid}.code`, '0')
  recover(cast)
  await running.get(eid)!.done

  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.exit_code, 0)
  assertEquals(s.final_text, 'done after truncation')
  assertEquals(s.latest_seq, 4)
  assertMatch(failure(eid) ?? '', /line 2: truncated \(1100028 bytes/)

  // The oversized line is dropped from the transcript — it never becomes an
  // entry (drain skips it, recording only the diagnostic asserted above) — while
  // the good message that followed still lands as a say.
  let entries = logOf(eid).entries
  assertEquals(entries.map((e) => sayText(e)), ['after'])
  let blob = JSON.stringify(readEntries(db, eid).map((e) => e.comps))
  assert(
    !blob.includes('x'.repeat(200)),
    'the oversized payload became an entry',
  )
})

slow('boot: a resumed log re-opens at its input marker', async () => {
  let eid = plant([
    INIT,
    RESULT,
    '{"type":"session.input","text":"more"}',
    '{"type":"result","final_text":"second","usage":{"output_tokens":9}}',
  ])
  recover(cast)
  await running.get(eid)!.done
  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.final_text, 'second') // the SECOND run's ending lands
  assertEquals(s.latest_seq, 4)
  assertEquals(failure(eid), undefined) // resume's shape is not a violation
})

slow(
  'boot: a live child is adopted, its file followed from where it is',
  async () => {
    let eid = plant([INIT])
    // A stand-in for the agent: detached, in its own group, with a pidfile —
    // all boot recovery has to go on.
    let child = new Deno.Command('setsid', {
      args: ['sleep', '9'],
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    Deno.writeTextFileSync(`${logsDir()}/${eid}.pid`, String(child.pid))
    recover(cast)
    let done = running.get(eid)!.done
    // The adopted tailer re-reads the file from byte 0: the row is planted
    // 'running', so what proves adoption is the summary it re-derives.
    await until(
      () => row(eid)?.provider_session_id == 'sid-1',
      'the adopted init',
    )
    assertEquals(row(eid)?.latest_seq, 1)

    // A half-written line is not a line yet — it waits for its newline.
    let f = Deno.openSync(log(eid), { append: true, write: true })
    f.writeSync(new TextEncoder().encode('{"type":"tool"'))
    await new Promise((go) => setTimeout(go, 30))
    assertEquals(row(eid)?.latest_seq, 1)
    f.writeSync(new TextEncoder().encode(`,"name":"read"}\n${RESULT}\n`))
    f.close()
    await until(() => row(eid)?.final_text == 'first', 'the terminal event')
    assertEquals(row(eid)?.latest_seq, 3)

    child.kill('SIGKILL')
    await child.status
    await done
    assertEquals(row(eid)?.status, 'completed')
  },
)

slow(
  'boot: a pending live comment completes its interrupted handoff',
  async () => {
    let eid = plant([INIT])
    writeSession(db, eid, {
      provider_session_id: 'sid-1',
      model: 'fake-fast',
      cwd: scratch,
      input_at: '2026-07-27T12:00:00Z',
    })
    let pending = say(eid, 'heard after restart')
    apply(db, pending)
    let child = new Deno.Command('setsid', {
      args: ['sleep', '9'],
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    Deno.writeTextFileSync(`${logsDir()}/${eid}.pid`, String(child.pid))

    recover(cast)
    await until(
      () => told(pending[1].eid) && row(eid)?.status == 'completed',
      'the recovered input handoff',
    )
    await child.status
    let events = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; text?: string })
    assertEquals(
      events.some((e) =>
        e.type == 'session.input' && e.text == 'heard after restart'
      ),
      true,
    )
  },
)

slow('a tail tick that only moves the counter stays off the wire', async () => {
  let eid = plant([INIT])
  let child = new Deno.Command('setsid', {
    args: ['sleep', '9'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  Deno.writeTextFileSync(`${logsDir()}/${eid}.pid`, String(child.pid))
  recover(cast)
  let done = running.get(eid)!.done
  await until(
    () => row(eid)?.provider_session_id == 'sid-1',
    'the adopted init',
  )

  // Chatter that changes no summary column: the row counts it, the wire
  // stays silent — a run's whole transcript must not re-render every
  // client per poll tick (T-7063). The lines are now ALSO ingested as entries
  // (T-16823): they journal (so the cursor advances) but are omitted from the
  // root delta, so a catch-up client still sees no changes to re-render.
  heard = []
  let c0 = snapshot(db).cursor ?? 0
  let f = Deno.openSync(log(eid), { append: true, write: true })
  f.writeSync(new TextEncoder().encode(
    '{"type":"message","text":"a"}\n{"type":"message","text":"b"}\n',
  ))
  await until(() => row(eid)?.latest_seq == 3, 'the counted lines')
  assertEquals(heard.filter((c) => c.name == 'session'), [])
  assertEquals(delta(db, c0).changes, [])

  // The terminal event is news — its summary rides the wire.
  f.writeSync(new TextEncoder().encode(`${RESULT}\n`))
  f.close()
  await until(() => row(eid)?.final_text == 'first', 'the terminal event')
  assert(
    heard.some((c) => c.name == 'session' && c.comp?.final_text == 'first'),
  )

  child.kill('SIGKILL')
  await child.status
  await done
})

slow('boot: a session whose provider is gone fails loudly', () => {
  let eid = plant([INIT], 'oracle')
  recover(cast)
  assertEquals(row(eid)?.status, 'failed')
  assertMatch(failure(eid) ?? '', /no adapter/)
})

slow('a comment resumes nothing it should not', async () => {
  // active: the bus delivers, the effect stays out of it
  let active = plant([INIT]) // status 'running'
  writeSession(db, active, { provider_session_id: 'sid-1' })
  await write(say(active, 'hi'))
  assertEquals(row(active)?.status, 'running') // untouched
  assertEquals(refusals(active), []) // delivery, not a failure to say
  // settled but never announced a provider thread: refused OUT LOUD
  let bare = plant([INIT])
  db.prepare("update session set status = 'completed' where eid = ?")
    .run(bare)
  await write(say(bare, 'hi'))
  assertEquals(row(bare)?.status, 'completed')
  assertMatch(refusals(bare)[0], /never announced a provider thread/)
  // THE FLOOR: refuse() writes its reply AS the session, so commented()
  // reads it as the session talking about itself and lets it lie. Without
  // it the reply re-enters the gate, fails to resume again, and refuses
  // forever — removing the writer arg HANGS this file rather than failing
  // it, so the stamp is asserted directly too and breaks fast.
  assertEquals(refusals(bare).length, 1) // the line above is the control
  assertEquals(
    (db.prepare(
      `select cr.via from comment c join created cr on cr.eid = c.eid
       where c.target = ? order by c.rowid desc limit 1`,
    ).get(bare) as { via: string | null }).via,
    bare,
  )
  // a persistent role never receives graph words through provider argv;
  // roles.ts sends a fixed task_context wake after the turn settles.
  let role = uid(), roleRun = plant([INIT])
  apply(db, [
    {
      eid: role,
      name: 'role',
      comp: { state: 'running', surface: 'managed' },
    },
    { eid: roleRun, name: 'session', comp: { role: role } },
  ])
  db.prepare("update session set status = 'completed' where eid = ?")
    .run(roleRun)
  let pending = say(roleRun, 'graph words stay in the graph')
  await write(pending)
  assertEquals(row(roleRun)?.status, 'completed')
  assertEquals(told(pending[1].eid), false)
})

slow(
  'a comment at a settled session joins the log and resumes it',
  async () => {
    // A real end-to-end run leaves a settled session with a worktree + thread.
    let { t } = seed()
    let { eid, done } = begin(t)
    await done
    assertEquals(row(eid)?.status, 'completed')
    let before = row(eid)!.latest_seq as number

    heard = []
    let entriesBefore = logOf(eid).entries.length
    let input = say(eid, 'and one more thing')
    let resumed = write(input)
    // Flipped running straight away — the effect's synchronous half.
    assertEquals(row(eid)?.status, 'running')
    assertEquals(row(eid)?.finished_at, null)
    assert(
      heard.some((c) => c.name == 'session' && c.comp?.status == 'running'),
    )

    // The continuation appends and the tailer settles it again. The words were
    // delivered to the run (told — the comment joined the conversation, woven
    // into the transcript by the reader), and the resumed turn grew the log.
    await resumed
    assertEquals(row(eid)?.status, 'completed')
    assert(told(input[1].eid))
    assert((row(eid)!.latest_seq as number) > before)
    assert(logOf(eid).entries.length > entriesBefore)
  },
)

slow('a session commenting on itself never resumes it', async () => {
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  let before = row(eid)!.latest_seq as number
  await write(say(eid, 'note to self'), eid) // the instrument IS the session
  assertEquals(row(eid)?.status, 'completed')
  assertEquals(row(eid)?.latest_seq, before) // the log never heard it
})

slow(
  'a comment steers a live managed session without settling it',
  async () => {
    let { t } = seed()
    let { eid, done } = begin(t)
    await done
    let reports = settleComments(t, eid).length
    // The resumed turn dawdles long enough for a comment to steer it.
    let resumed = write(say(eid, 'delay:1000 keep going'))
    assertEquals(row(eid)?.status, 'running')
    let steer = say(eid, 'also: rename it')
    await write(steer)
    await resumed
    await until(
      () => told(steer[1].eid) && row(eid)?.status == 'completed',
      // Both halves named: if this ever times out again, the message says
      // whether the steer went undelivered or the run never settled — a
      // stalled fact and a slow one want opposite fixes.
      () =>
        `the steered continuation to settle (steer delivered=${
          told(steer[1].eid)
        }, status=${row(eid)?.status}, exit=${row(eid)?.exit_code}, error=${
          failure(eid)
        }, stop=${row(eid)?.stop_reason}, seq=${row(eid)?.latest_seq})`,
    )
    let events = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
      .map((l) =>
        JSON.parse(l) as { type: string; text?: string; final_text?: string }
      )
    assertEquals(
      events.filter((e) => e.type == 'session.input').map((e) => e.text),
      ['delay:1000 keep going', 'also: rename it'],
    )
    assertEquals(
      events.some((e) => e.text == 'working: also: rename it'),
      true,
    )
    assertEquals(
      events.some((e) =>
        e.type == 'result' && e.final_text?.includes('delay:1000 keep going')
      ),
      false,
    )
    // Steering is one continuous session, not an interrupted settlement.
    assertEquals(settleComments(t, eid).length, reports + 1)
  },
)

slow('a failed run stays down until the next word resumes it', async () => {
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  await write(say(eid, 'fail:3 then crash'))
  assertEquals(row(eid)?.status, 'failed') // no flush — a broken run stays down
  let wake = say(eid, 'wake up')
  await write(wake)
  await until(() => row(eid)?.status == 'completed', 'the woken run to settle')
  assertEquals(told(wake[1].eid), true)
})

slow('refused words stay owed, never marked told', async () => {
  let bare = plant([INIT])
  db.prepare("update session set status = 'completed' where eid = ?").run(bare)
  let s = say(bare, 'hello?')
  await write(s)
  assertMatch(refusals(bare)[0], /never announced a provider thread/)
  assertEquals(told(s[1].eid), false)
})

// A bare git call inside a session's worktree — the test playing owner.
let inTree = (cwd: string, ...args: string[]) =>
  new Deno.Command('git', { args, cwd, stdout: 'null', stderr: 'null' })
    .outputSync()

slow(
  'tidy: a merged clean tree goes at boot, unmerged work stays',
  async () => {
    let a = begin(seed().t)
    await a.done
    let b = begin(seed().t)
    await b.done
    let treeA = String(row(a.eid)!.cwd), branchA = String(row(a.eid)!.branch)
    let treeB = String(row(b.eid)!.cwd)
    // b runs ahead of main: a commit on its branch that never merged
    Deno.writeTextFileSync(`${treeB}/ahead.txt`, 'unmerged')
    inTree(treeB, 'add', '-A')
    inTree(treeB, 'commit', '-m', 'ahead')
    heard = []
    await tidy(cast)
    // a: its branch tip IS the base tip, tree clean — worktree and branch go.
    // The row keeps its cwd for thread identity and sheds the branch marker.
    assertThrows(() => Deno.statSync(treeA))
    assertEquals(row(a.eid)?.cwd, treeA)
    assertEquals(row(a.eid)?.branch, null)
    assertEquals(
      inTree(scratch, 'rev-parse', '--verify', branchA).success,
      false,
    )
    assert(heard.some((c) => c.eid == a.eid && c.name == 'session'))
    // b: kept, untouched — main does not contain its commit
    assert(Deno.statSync(treeB).isDirectory)
    assert(row(b.eid)?.cwd)
    assert(row(b.eid)?.branch)
  },
)

slow('tidy: a dirty tree stays, whatever its branch says', async () => {
  let { eid, done } = begin(seed().t)
  await done
  let tree = String(row(eid)!.cwd)
  Deno.writeTextFileSync(`${tree}/scratch.txt`, 'uncommitted')
  await tidy(cast)
  assert(Deno.statSync(tree).isDirectory)
  assert(row(eid)?.cwd)
})

slow('tidy: an absent tree is reconciled once', async () => {
  let { eid, done } = begin(seed().t)
  await done
  let tree = String(row(eid)!.cwd)
  Deno.removeSync(tree, { recursive: true })
  heard = []
  await tidy(cast)
  await tidy(cast)
  assertEquals(row(eid)?.cwd, tree)
  assertEquals(row(eid)?.branch, null)
  assertEquals(
    heard.filter((c) => c.eid == eid && c.name == 'session').length,
    1,
  )
})

slow('a comment after the sweep regrows the worktree and resumes', async () => {
  let { p, t } = seed()
  let { eid, done } = begin(t)
  await done
  let tree = String(row(eid)!.cwd), branch = String(row(eid)!.branch)
  await tidy(cast) // merged and clean: swept, with its exact path retained
  assertEquals(row(eid)?.cwd, tree)
  assertEquals(row(eid)?.branch, null)
  let resumed = write(say(eid, 'one more thing'))
  await until(() => row(eid)?.status == 'running', 'the regrown resume')
  assertEquals(row(eid)?.cwd, tree) // the SAME path — the thread lives there
  assertEquals(row(eid)?.branch, branch)
  assert(Deno.statSync(tree).isDirectory)
  await resumed
  assertEquals(row(eid)?.status, 'completed') // the continuation settled
  assertEquals(refusals(eid), [])

  // Rows swept before the visible-root migration lost cwd. Their old path is
  // deterministic, so they still resume on the ground where their thread was
  // born instead of silently moving it.
  await tidy(cast)
  writeSession(db, eid, { cwd: null })
  let legacy = write(say(eid, 'from the old root'))
  await until(() => row(eid)?.status == 'running', 'the legacy regrow')
  assertEquals(row(eid)?.cwd, tree)
  await legacy
  assertEquals(row(eid)?.status, 'completed')

  // and when the graph can't place a tree, the refusal is said
  writeSession(db, eid, { cwd: null })
  db.prepare('delete from repo where eid = ?').run(p)
  await write(say(eid, 'hello?'))
  assertEquals(row(eid)?.status, 'completed')
  assertMatch(refusals(eid)[0], /no worktree to resume in/)
})

// An operator's session as the SessionStart hook reifies one: an id, a cwd,
// a process pid, and the transcript its provider keeps. The transcript must
// live in that provider's store, so the fixture writes one there.
// Called with no lines it reports NO transcript — the operator whose hook
// never named one (most of them, on the owner's graph): nothing to follow,
// and a door all the same.
let stores = {
  claude: `${Deno.env.get('HOME')}/.claude/projects/tasks-test`,
  codex: `${Deno.env.get('CODEX_HOME')}/sessions`,
}
for (let store of Object.values(stores)) {
  try {
    Deno.removeSync(store, { recursive: true })
  } catch { /* never made */ }
}
let announce = (
  pid: number,
  lines?: string[],
  transcript = '',
  provider = 'claude',
) => {
  let eid = uid()
  let store = stores[provider as keyof typeof stores] ?? stores.claude
  Deno.mkdirSync(store, { recursive: true })
  let path = transcript || (lines ? `${store}/${uid()}.jsonl` : '')
  if (lines && !transcript) {
    Deno.writeTextFileSync(path, lines.map((l) => `${l}\n`).join(''))
  }
  apply(db, [{
    eid,
    name: 'session',
    comp: {
      id: uid(),
      cwd: scratch,
      pid,
      provider,
      ...(path ? { transcript: path } : {}),
    },
  }])
  return { eid, path }
}

let SAID = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-07-26T12:00:00Z',
  message: { content: [{ type: 'text', text: 'hello from a tty' }] },
})

slow(
  "external session logs read each provider's confined transcript",
  async () => {
    // The reader path (T-16798): an external session's confined transcript is
    // INGESTED into graph entries (drainNative), then read as entries — no
    // file-log door. The projection detail is ingest_native_test's; here we hold
    // that a confined store admits its own, and a crossed/traversal/symlink
    // reference reads NOTHING (a transcript is a reference, never a capability).
    let c = await fakeClaude()
    let fresh = () => ({ at: 0, seq: 0, ended: false, errs: [] })
    let drained = async (eid: string) => {
      await drainNative(eid, fresh(), cast)
      return logOf(eid).entries
    }
    // The entry carries an ingest `at` (created.at); the transcript SHAPE is
    // what we hold here, so strip the clock before comparing the first row.
    let firstRow = (entries: { row?: unknown }[]) => {
      let { at: _at, ...row } = (entries[0]?.row ?? {}) as { at?: string }
      return row
    }

    let { eid, path } = announce(c.pid, [SAID])
    assertEquals(firstRow(await drained(eid)), {
      kind: 'say',
      role: 'agent',
      text: 'hello from a tty',
    })

    // A contradictory provider cannot cross into another store: this claude path
    // is refused when the session says codex, so nothing is ingested.
    let crossed = announce(c.pid, [], path, 'codex')
    assertEquals(await drained(crossed.eid), [])

    let codex = announce(
      c.pid,
      [JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hello Codex' },
      })],
      '',
      'codex',
    )
    assertEquals(firstRow(await drained(codex.eid)), {
      kind: 'say',
      role: 'user',
      text: 'hello Codex',
    })

    // Traversal and a symlink out of the provider's store both read nothing.
    let sneak = announce(c.pid, [], `${logsDir()}/../../etc/hostname`)
    assertEquals(await drained(sneak.eid), [])
    let outside = Deno.makeTempFileSync({ suffix: '.jsonl' })
    let link = `${stores.codex}/escape.jsonl`
    Deno.symlinkSync(outside, link)
    let escaped = announce(c.pid, [], link, 'codex')
    assertEquals(await drained(escaped.eid), [])
    Deno.removeSync(link)
    Deno.removeSync(outside)
    c.kill('SIGKILL')
    await c.status
  },
)

slow('an external Codex transcript follows its provider process', async () => {
  let c = await fakeCodex()
  let line = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'user_message', message: 'one' },
  })
  let { eid, path } = announce(c.pid, [line], '', 'codex')
  watched(cast)(eid, { pid: c.pid })
  await until(() => !!row(eid)?.started_at, 'the Codex watch to start')
  assertEquals(row(eid)?.latest_seq, 1)
  Deno.writeTextFileSync(path, `${line}\n`, { append: true })
  await until(() => row(eid)?.latest_seq == 2, 'the Codex log to grow')
  c.kill('SIGKILL')
  await c.status
  await until(() => !!row(eid)?.finished_at, 'the Codex process to leave')
})

// T-16360: Codex's provider process is per-turn, so an absent codex that
// last reported `turn: idle` is idle between turns, not ended. Reading the
// door's absence as the end froze S-15625 at its first turn while its owner
// kept steering it — so an idle codex whose process left keeps waiting, no
// finished_at, and re-arms when its next turn stamps a pid.
slow(
  'an idle Codex between turns is not ended when its process leaves',
  async () => {
    let c = await fakeCodex()
    let { eid } = announce(c.pid, undefined, '', 'codex')
    db.prepare("update session set turn = 'idle' where eid = ?").run(eid)
    c.kill('SIGKILL')
    await c.status
    watched(cast)(eid, { pid: c.pid })
    assertEquals(row(eid)?.finished_at, null) // idle, not finished
    assertEquals(row(eid)?.started_at, null) // no watch began
  },
)

// A codex that vanished MID-turn (`busy`) crashed: that door shutting is a
// real ending, stamped like any other. Only the between-turns lull is spared.
slow('a Codex that left mid-turn ends like any other door', async () => {
  let c = await fakeCodex()
  let { eid } = announce(c.pid, undefined, '', 'codex')
  db.prepare("update session set turn = 'busy' where eid = ?").run(eid)
  c.kill('SIGKILL')
  await c.status
  watched(cast)(eid, { pid: c.pid })
  assertEquals(!!row(eid)?.finished_at, true) // a mid-turn exit is the end
})

slow(
  'a session we never forked is watched by its door, not its exit code',
  async () => {
    let c = await fakeClaude()
    let { eid } = announce(c.pid, [SAID])
    watched(cast)(eid, { pid: c.pid })
    await until(() => !!row(eid)?.started_at, 'the watch to start')
    assertEquals(row(eid)?.finished_at, null) // still at the keyboard
    assertEquals(row(eid)?.latest_seq, 1)
    c.kill('SIGKILL')
    await c.status
    await until(() => !!row(eid)?.finished_at, 'the door to shut')
    // The irreducible difference, said rather than faked.
    assertEquals(row(eid)?.exit_code, null)
    assertEquals(row(eid)?.status, null)
  },
)

// The bug the tray wore (T-7461): watching asked the TRANSCRIPT whether to
// bother, so a session that never reported one was never asked about and
// never stamped — forever pid-and-no-finished_at, indistinguishable from a
// live operator. Following and liveness are two questions; only the door
// answers the second.
slow('a transcript-less session is watched by its door too', async () => {
  let c = await fakeClaude()
  let { eid } = announce(c.pid)
  watched(cast)(eid, { pid: c.pid })
  await until(() => !!row(eid)?.started_at, 'the watch to start')
  assertEquals(row(eid)?.finished_at, null) // still at the keyboard
  assertEquals(row(eid)?.latest_seq, 0) // nothing to count, and that's fine
  c.kill('SIGKILL')
  await c.status
  await until(() => !!row(eid)?.finished_at, 'the door to shut')
})

// A pid outlives its process and gets reused, so a row whose pid is no
// longer a claude serving IT is a ghost: end it and arm no heartbeat. The
// ending is the last time we HEARD from it, not the moment we noticed —
// a restart that stamped now() would parade every ghost through the tray's
// "finished recently" digest.
slow('a ghost row ends when it was last heard from, unwatched', async () => {
  let c = await fakeClaude()
  let { eid } = announce(c.pid)
  c.kill('SIGKILL')
  await c.status
  watched(cast)(eid, { pid: c.pid })
  let born = db.prepare('select at from created where eid = ?').get(eid) as {
    at: string
  }
  assertEquals(row(eid)?.finished_at, born.at)
  assertEquals(row(eid)?.started_at, null) // no watch began, so none is told
})

slow(
  'a comment wakes an external session only when nobody is home',
  async () => {
    let c = await fakeClaude()
    let { eid } = announce(c.pid, [SAID], '', 'fake')
    await write(say(eid, 'still there?'))
    assertEquals(refusals(eid), []) // its channel delivered — nothing to do
    assertEquals(existsSync(log(eid)), false) // and nothing was spawned
    c.kill('SIGKILL')
    await c.status
    // Dead: the words go back in by the door the CLI left open — the
    // session's own id IS the thread `--resume` takes.
    await write(say(eid, 'anyone there?'))
    await until(() => existsSync(log(eid)), 'the resumed run to start')
    assertEquals(refusals(eid), [])
  },
)

// The boot lease-reap (T-18651): a session that ended abnormally never ran its
// wrap, so its claim leaked. reapLeases releases every lease held by an ENDED
// session and spares every live one — the same awake() predicate the doctor
// reads. In-process, so it is fast, not slow().
Deno.test('reapLeases frees an ended session lease, spares a live one', () => {
  let claimed = (task: string) => {
    let s = uid()
    apply(db, [{ eid: s, name: 'session', comp: { id: uid() } }])
    apply(db, [
      { eid: task, name: 'entity', comp: { eid: task } },
      { eid: task, name: 'doc', comp: { title: 'leased', body: '' } },
      { eid: task, name: 'task', comp: { status: 'open' } },
      { eid: task, name: 'claim', comp: { session: s } },
    ])
    return s
  }
  let live = uid(), dead = uid()
  writeSession(db, claimed(live), { status: 'running' }) // awake
  writeSession(db, claimed(dead), {
    status: 'completed',
    finished_at: '2026-01-01T00:00:00Z',
  }) // ended
  let leaseOf = (t: string) =>
    rows(snapshot(db)).find((r) => r.eid == t)?.comps.claim
  assert(leaseOf(live) && leaseOf(dead), 'both leased before the reap')

  let out = reapLeases(cast)
  assert(leaseOf(live), 'the live session keeps its lease')
  assertEquals(leaseOf(dead), undefined, 'the ended session lease is released')
  // The release rode apply()+cast — clients heard the claim-null, not a stamp.
  assert(
    out.some((c) => c.eid == dead && c.name == 'claim' && c.comp == null),
    'the release is graph data on the cast',
  )
  // Idempotent: a released lease is gone, so a second boot finds nothing.
  assertEquals(reapLeases(cast), [])
})
