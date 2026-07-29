// The `task new` stray-flag guard: agents pattern-match to --flags, but the
// CLI grammar is dot-params. The guard must catch both the glued `--project=P`
// and the space-separated `--project P` forms — the latter is what agents
// actually type, and the bug that let it through polluted the owner board.
import { assertEquals, assertMatch, assertThrows } from '@std/assert'
import {
  bodyOf,
  claimedDigest,
  claudeHookSettings,
  claudeLaunch,
  codexArgs,
  codexHookArgs,
  codexLaunch,
  finalText,
  hookDialect,
  hookOperator,
  hookProvider,
  hookTurn,
  leadPrio,
  lifecycleHooks,
  operatorHook,
  roleEid,
  strayFlag,
  subagentDigest,
  subject,
  subjectUsage,
} from './cli.ts'
import { type Row, rows } from './client.ts'
import type { Snapshot } from './types.ts'

let transcript = (...events: unknown[]) => {
  let path = Deno.makeTempFileSync()
  try {
    Deno.writeTextFileSync(
      path,
      events.map((e) => JSON.stringify(e)).join('\n'),
    )
    return finalText(path)
  } finally {
    Deno.removeSync(path)
  }
}

let cli = (...args: string[]) =>
  new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', new URL('./cli.ts', import.meta.url).pathname, ...args],
    env: { TASKS_HOST: '127.0.0.1:1' },
  }).output()

let bareCli = (env: Record<string, string>) =>
  new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', new URL('./cli.ts', import.meta.url).pathname],
    clearEnv: true,
    env,
  }).output()

let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

Deno.test('subject: sentences route through the existing CLI verbs', () => {
  let route = (line: string) => {
    let [id, ...args] = line.split(' ')
    return subject(id, args)
  }
  assertEquals(route('T-3'), { cmd: 'show', args: ['T-3'] })
  assertEquals(route('T-3 show --json'), {
    cmd: 'show',
    args: ['T-3', '--json'],
  })
  assertEquals(route('T-3 as markdown'), { cmd: 'show', args: ['T-3'] })
  assertEquals(route('T-3 as json'), {
    cmd: 'show',
    args: ['T-3', '--json'],
  })
  assertEquals(route('T-3 is wip'), {
    cmd: 'set',
    args: ['T-3', '.status=wip'],
  })
  for (let edge of ['requires', 'contains', 'reads', 'about']) {
    assertEquals(route(`T-3 ${edge} T-9 --gone`), {
      cmd: 'dep',
      args: ['T-3', edge, 'T-9', '--gone'],
    })
  }
})

Deno.test('subject: old commands and explicit focused commands keep their door', () => {
  assertEquals(subject('show', ['T-3']), undefined)
  assertEquals(subject('dep', ['T-3', 'requires', 'T-9']), undefined)
  assertEquals(subject('fix', ['T-3']), undefined)
  assertEquals(subject('T-3', [':done']), undefined)
})

Deno.test('subject: malformed sentences teach the contextual grammar', () => {
  assertThrows(() => subject('T-3', ['requires']), Error, '<id> [--gone]')
  assertThrows(
    () => subject('T-3', ['show', 'T-9']),
    Error,
    '[show] [--json]',
  )
  assertThrows(() => subject('T-3', ['is', 'blocked']), Error, 'status is one')
  assertThrows(() => subject('T-3', ['as', 'yaml']), Error, 'format is one')
  assertThrows(
    () => subject('T-3', ['frobnicate']),
    Error,
    'task T-3 --help',
  )
})

Deno.test('task subject help is contextual and needs no server', async () => {
  let out = await cli('T-3', '--help')
  assertEquals(out.code, 0)
  let stdout = text(out.stdout)
  assertMatch(stdout, /task T-3 — subject-first verbs/)
  assertMatch(stdout, /requires\|contains\|reads\|about <id> \[--gone\]/)
  assertMatch(stdout, /task T-3 is open\|wip\|done\|cancelled/)
  assertEquals(subjectUsage('T-3').trim(), stdout.trim())
})

Deno.test('bodyOf: only explicit stdin spellings read the pipe', () => {
  let cases: [string[], string[], string, number][] = [
    [['--body=-'], [], 'piped', 1],
    [['--body=@-'], [], 'piped', 1],
    [['--body=literal'], [], 'literal', 0],
    [[], ['word', 'body'], 'word body', 0],
  ]
  for (let [flags, words, want, reads] of cases) {
    let read = 0
    let got = bodyOf(flags, words, {
      terminal: () => false,
      read: () => (read++, ' piped\n'),
    })
    assertEquals({ flags, got, read }, { flags, got: want, read: reads })
  }
})

Deno.test('bodyOf: both stdin spellings refuse a TTY', () => {
  for (let b of ['-', '@-']) {
    let read = 0
    assertThrows(
      () =>
        bodyOf([`--body=${b}`], [], {
          terminal: () => true,
          read: () => (read++, 'piped'),
        }),
      Error,
      // the error names the spelling the caller typed, not a synonym
      `--body=${b}: stdin is a TTY`,
    )
    assertEquals(read, 0)
  }
})

Deno.test('codexArgs: full access and lifecycle lead, caller args keep order', () => {
  let hooks = codexHookArgs()
  assertEquals(codexArgs(['resume', '--last']), [
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    ...hooks,
    'resume',
    '--last',
  ])
  assertEquals(hooks.filter((arg) => arg == '-c').length, 5)
})

Deno.test('finalText: Claude and Codex transcripts yield the closing answer', () => {
  assertEquals(
    transcript({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Claude closes' }] },
    }),
    'Claude closes',
  )
  assertEquals(
    transcript(
      {
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'Codex commentary',
          phase: 'commentary',
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'Codex closes',
          phase: 'final_answer',
        },
      },
    ),
    'Codex closes',
  )
})

Deno.test('hookDialect: Codex payload and Claude transcript name the provider', () => {
  let path = Deno.makeTempFileSync()
  try {
    Deno.writeTextFileSync(
      path,
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-opus-5' },
      }),
    )
    assertEquals(
      hookDialect({
        model: 'claude-opus-5',
        transcript_path: path,
      }, 'claude'),
      {
        provider: 'claude',
        model: 'claude-opus-5',
        transcript: path,
      },
    )
    assertEquals(
      hookDialect({
        model: 'gpt-5.6-sol',
        transcript_path: '/unstable/codex.jsonl',
      }, 'codex'),
      {
        provider: 'codex',
        model: 'gpt-5.6-sol',
        transcript: '/unstable/codex.jsonl',
      },
    )
    assertEquals(hookDialect({}).provider, 'claude')
  } finally {
    Deno.removeSync(path)
  }
})

Deno.test('hookProvider: invocation name wins; ancestry recovers old hooks', () => {
  let find = (provider: string) =>
    provider == 'claude' ? 10 : provider == 'codex' ? 20 : undefined
  assertEquals(hookProvider('claude', find), 'claude')
  assertEquals(hookProvider('codex', find), 'codex')
  assertEquals(
    hookProvider('', find, (pid, root) => pid == 20 && root == 10),
    'codex',
  )
  assertEquals(hookProvider('', find, () => false), 'claude')
  assertEquals(hookProvider('', () => undefined), undefined)
})

Deno.test('task codex is discoverable with its own help', async () => {
  let out = await cli('codex', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /task codex \[--operator\] \[codex args\.\.\.\][\s\S]*graph participant[\s\S]*task codex --operator resume --last/,
  )
})

Deno.test('task comment help teaches verdict-bearing comments', async () => {
  let out = await cli('comment', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /--verdict=approved\|rejected\|changes_requested/,
  )
})

Deno.test('task claude scopes operator capability and strips its local flag', () => {
  let launch = claudeLaunch(
    ['--model', 'opus', '--operator', '--continue'],
    true,
    42,
  )
  assertEquals(launch, {
    args: [
      '--dangerously-skip-permissions',
      '--settings',
      claudeHookSettings(),
      '--channels',
      'plugin:tasks@tasks-fleet',
      '--model',
      'opus',
      '--continue',
    ],
    env: {
      TASKS_OPERATOR: '42',
      TASKS_TASK: '',
      CLAUDE_CODE_CHILD_SESSION: '',
    },
  })

  let ordinary = claudeLaunch(['--continue'], true, 42)
  assertEquals(ordinary.env, {
    TASKS_OPERATOR: '',
    TASKS_TASK: '',
    CLAUDE_CODE_CHILD_SESSION: '',
  })
  assertEquals(
    claudeLaunch(['--', '--operator'], true, 42).args.slice(-2),
    ['--', '--operator'],
  )
})

Deno.test('task codex scopes operator capability and strips its local flag', () => {
  assertEquals(
    codexLaunch(['--operator', 'resume', '--last'], 42),
    {
      args: [
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
        ...codexHookArgs(),
        'resume',
        '--last',
      ],
      env: {
        TASKS_OPERATOR: '42',
        TASKS_TASK: '',
        CLAUDE_CODE_CHILD_SESSION: '',
      },
    },
  )
  assertEquals(codexLaunch(['resume', '--last'], 42).env.TASKS_OPERATOR, '')
  assertEquals(
    codexLaunch(['--', '--operator'], 42).args.slice(-2),
    ['--', '--operator'],
  )
})

Deno.test('operator capability follows the explicit launcher marker', () => {
  let env = (vars: Record<string, string>) => (name: string) => vars[name]
  let under = (pid: number, root: number) => pid == 7 && root == 42
  assertEquals(
    operatorHook(7, env({ TASKS_OPERATOR: '42' }), under),
    true,
  )
  assertEquals(operatorHook(7, env({ TASKS_OPERATOR: '99' }), under), false)
  assertEquals(operatorHook(7, env({}), under), false)
})

Deno.test('role binding accepts only a live role entity', () => {
  let role = {
    eid: 'role-eid',
    num: 7,
    kind: 'role',
    comps: { role: { state: 'running' } },
  }
  let task = {
    eid: 'task-eid',
    num: 8,
    kind: 'task',
    comps: { task: { status: 'open' } },
  }
  assertEquals(roleEid([role, task], 'R-7'), role.eid)
  assertEquals(roleEid([role, task], task.eid), undefined)
  assertEquals(roleEid([role, task], 'missing'), undefined)
})

Deno.test('a bound role carries operator capability without a launcher marker', () => {
  assertEquals(hookOperator('role-eid'), true)
  // Unbound falls through to the launcher marker, which is read from the
  // ambient environment — so clear it, or this asserts nothing when the suite
  // itself is run from inside an operator session.
  let marker = Deno.env.get('TASKS_OPERATOR')
  Deno.env.delete('TASKS_OPERATOR')
  try {
    assertEquals(hookOperator(undefined, undefined), false)
  } finally {
    if (marker != undefined) Deno.env.set('TASKS_OPERATOR', marker)
  }
})

Deno.test('Codex turn hooks announce only busy and idle boundaries', () => {
  assertEquals(hookTurn({ hook_event_name: 'UserPromptSubmit' }), 'busy')
  assertEquals(hookTurn({ hook_event_name: 'Stop' }), 'idle')
  assertEquals(hookTurn({ hook_event_name: 'SessionStart' }), undefined)
})

Deno.test('the canonical operator launcher opts into work injection', () => {
  let path = new URL('../bin/operate-run', import.meta.url)
  let script = Deno.readTextFileSync(path)
  assertMatch(script, /exec task claude --operator "\$\{args\[@\]\}"/)
  assertMatch(script, /printf 'task claude --operator'/)
})

Deno.test('task wrap help documents the legacy alias', async () => {
  let out = await cli('wrap', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /task wrap \[sid\] \[--hook\][\s\S]*task session wrap/,
  )
})

Deno.test('deprecated routes leave root help but teach at their door', async () => {
  let root = await cli('--help')
  assertEquals(root.code, 0)
  assertEquals(/^\s+task dep\b/m.test(text(root.stdout)), false)

  let direct = await cli('dep', '--help')
  assertEquals(direct.code, 0)
  assertMatch(
    text(direct.stdout),
    /task dep <id> <type> <child> \[--gone\][\s\S]*Deprecated: superseded/,
  )

  let bare = await cli('dep')
  assertEquals(bare.code, 1)
  assertMatch(
    text(bare.stderr),
    /usage: task dep <id> <type> <child> \[--gone\][\s\S]*deprecated:/,
  )
})

Deno.test('task session wrap help never runs the hook verb', async () => {
  let out = await cli('session', 'wrap', '--help')
  assertEquals(out.code, 0)
  assertMatch(text(out.stdout), /task session wrap \[sid\] \[--hook\]/)
})

Deno.test('nested and palette help always resolves before effects', async () => {
  let cases: [string[], RegExp][] = [
    [['mail', 'show', '--help'], /^task mail show/],
    [['inbox', 'archive', '--help'], /^task inbox archive/],
    [[':fix', '--help'], /^task :fix/],
    [['fix', '--help'], /^task :fix/],
    [['T-1', ':done', '--help'], /^task :done/],
  ]
  for (let [args, expected] of cases) {
    let out = await cli(...args)
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), expected)
    assertEquals(text(out.stderr), '')
  }
})

Deno.test('task wrap rejects body before touching the session', async () => {
  let out = await cli('wrap', 'test-session', '--body=@brief.md')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /wrap takes no --body.+task session brief --body=…/,
  )
})

Deno.test('task verbs reject unknown flags before their effects', async () => {
  let out = await cli('release', 'T-1', '--wat')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /release does not take --wat/,
  )
})

Deno.test('task verbs reject surplus words and missing values before effects', async () => {
  let cases: [string[], RegExp][] = [
    [['claim', 'T-1', 'sess', 'extra'], /claim expected 1–2 arguments/],
    [['inbox', 'archive', 'E-1', 'extra'], /expected 1 argument, got 2/],
    [['backup', 'extra'], /backup expected 0 arguments/],
    [['history', 'T-1', '-n'], /-n needs a positive number/],
  ]
  for (let [args, expected] of cases) {
    let out = await cli(...args)
    assertEquals(out.code, 1)
    assertEquals(text(out.stdout), '')
    assertMatch(text(out.stderr), expected)
  }
})

Deno.test('task set rejects surplus positional arguments', async () => {
  let out = await cli('set', 'T-1', '.status=open', 'surplus')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(text(out.stderr), /task set <id> \.prop=value \.\.\./)
})

Deno.test('task dep rejects surplus positional arguments', async () => {
  let out = await cli('dep', 'T-1', 'requires', 'T-2', 'surplus')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /task dep <id> <type> <child> \[--gone\]/,
  )
})

Deno.test('launchers scope lifecycle hooks to their provider invocation', () => {
  let codex = lifecycleHooks('codex')
  assertEquals(Object.keys(codex), [
    'SessionStart',
    'SubagentStart',
    'UserPromptSubmit',
    'Stop',
    'SessionEnd',
  ])
  assertMatch(
    codex.SessionStart[0].hooks[0].command,
    /TASKS_PROVIDER=codex task session context --hook/,
  )
  assertMatch(
    codex.SubagentStart[0].hooks[0].command,
    /task session context --hook/,
  )
  assertMatch(
    codex.UserPromptSubmit[0].hooks[0].command,
    /task session turn --hook/,
  )
  assertMatch(
    codex.Stop[0].hooks[0].command,
    /task session turn --hook/,
  )
  assertEquals(codex.UserPromptSubmit[0].hooks[0].timeout, 3)
  assertEquals(codex.Stop[0].hooks[0].timeout, 3)
  assertMatch(
    codex.SessionEnd[0].hooks[0].command,
    /task session wrap --hook/,
  )
  assertEquals(codex.SessionEnd[0].hooks[0].timeout, 3)

  let claude = lifecycleHooks('claude')
  assertEquals(Object.keys(claude), [
    'SessionStart',
    'SubagentStart',
    'UserPromptSubmit',
    'Stop',
    'SessionEnd',
  ])
  // Claude reports turn boundaries like every other adapter, and carries the
  // project's self-clear gate as a SECOND Stop hook — ordered after the turn
  // stamp so the cheap fact never queues behind the expensive check.
  assertMatch(
    claude.UserPromptSubmit[0].hooks[0].command,
    /TASKS_PROVIDER=claude task session turn --hook/,
  )
  assertMatch(claude.Stop[0].hooks[0].command, /task session turn --hook/)
  assertEquals(claude.Stop[0].hooks[0].timeout, 3)
  assertMatch(claude.Stop[1].hooks[0].command, /self-clear-stop\.sh/)
  assertEquals(claude.Stop[1].hooks[0].timeout, 20)
  // Codex has no self-clear gate, so its Stop carries the turn stamp alone.
  assertEquals(codex.Stop.length, 1)
  assertMatch(
    claude.SessionStart[0].hooks[0].command,
    /TASKS_PROVIDER=claude task session context --hook/,
  )
  assertEquals(
    JSON.parse(claudeHookSettings()).hooks,
    claude,
  )
  let project = JSON.parse(
    Deno.readTextFileSync(
      new URL('../.claude/settings.json', import.meta.url),
    ),
  )
  assertEquals(project.hooks, undefined)
})

Deno.test('task claude appends project settings only for its invocation', () => {
  let dir = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(`${dir}/.tasks`)
    Deno.writeTextFileSync(
      `${dir}/.tasks/claude-settings.json`,
      JSON.stringify({
        env: { DESK: 'trading' },
        hooks: {
          SessionStart: [{
            hooks: [{ type: 'command', command: 'echo rearm' }],
          }],
        },
      }),
    )
    let settings = JSON.parse(claudeHookSettings(dir))
    assertEquals(settings.env, { DESK: 'trading' })
    assertEquals(settings.hooks.SessionStart.length, 2)
    assertMatch(
      settings.hooks.SessionStart[0].hooks[0].command,
      /task session context --hook/,
    )
    assertEquals(
      settings.hooks.SessionStart[1].hooks[0].command,
      'echo rearm',
    )
    assertEquals(
      JSON.parse(claudeLaunch([], true, 42, dir).args[2]),
      settings,
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// `task new P1 …` honors the documented shorthand (T-6741): a LEADING
// P<n> becomes priority, a bare word stays title, and a mid-title P keeps
// its words.
Deno.test('leadPrio: a leading P<n> is priority, else it is a title word', () => {
  assertEquals(leadPrio(['P1', 'Fix', 'it']), {
    words: ['Fix', 'it'],
    priority: 1,
  })
  assertEquals(leadPrio(['p2', 'Ship']), { words: ['Ship'], priority: 2 })
  // no leading P: every word is title, no priority
  assertEquals(leadPrio(['Fix', 'the', 'P2', 'bug']), {
    words: ['Fix', 'the', 'P2', 'bug'],
  })
  // a bare leading digit is a title word, never priority
  assertEquals(leadPrio(['3', 'reasons']), { words: ['3', 'reasons'] })
})

Deno.test('strayFlag: clean title has no stray flag', () => {
  assertEquals(strayFlag(['Fix', 'the', 'login', 'bug']), null)
})

Deno.test('strayFlag: space-separated --flag (the real corruption)', () => {
  // `task new "Title --project P-30 --body ..."` → these words.
  assertEquals(
    strayFlag(['Title', '--project', 'P-30', '--body', 'stuff']),
    { got: '--project', suggest: '.project=P-30' },
  )
})

Deno.test('strayFlag: glued --flag=value', () => {
  assertEquals(
    strayFlag(['Title', '--project=P-30']),
    { got: '--project=P-30', suggest: '.project=P-30' },
  )
})

Deno.test('strayFlag: trailing --flag with no value', () => {
  assertEquals(
    strayFlag(['Title', '--body']),
    { got: '--body', suggest: '.body=…' },
  )
})

// The suggestion is checked before it is offered. `.blocked-by` routes
// nowhere, so there is nothing to recommend — and recommending it sent
// agents to a spelling that landed in the task's TITLE.
Deno.test('strayFlag: a flag with no matching prop suggests nothing', () => {
  assertEquals(
    strayFlag(['Title', '--blocked-by', 'T-9']),
    { got: '--blocked-by' },
  )
})

Deno.test('strayFlag: bare -- is not a flag', () => {
  assertEquals(strayFlag(['Title', '--', 'more']), null)
})

// A subagent (a Task-tool child) sees ONLY its task — never the operator's
// mail/lately/fleet/previously. subagentDigest is that lone output: the
// claimed task's block, the TASKS_TASK block, or a bare identity line.
let S = 'bbbbbbbb-0000-4000-8000-000000000001'
let T = 'bbbbbbbb-0000-4000-8000-000000000002'
let sub: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sub-1', agent_type: 'general' } },
    { eid: T, name: 'entity', comp: { eid: T, num: 2, created_at: '' } },
    { eid: T, name: 'doc', comp: { title: 'Child work', body: '' } },
    { eid: T, name: 'task', comp: { status: 'wip', priority: 0 } },
    { eid: T, name: 'claim', comp: { session_eid: S } },
  ],
  deps: [],
}

let N = 'bbbbbbbb-0000-4000-8000-000000000003'
let O = 'bbbbbbbb-0000-4000-8000-000000000004'
let graph: Snapshot = {
  changes: [
    ...sub.changes,
    { eid: N, name: 'entity', comp: { eid: N, num: 3, created_at: '' } },
    { eid: N, name: 'session', comp: { id: 'idle-1' } },
    { eid: O, name: 'entity', comp: { eid: O, num: 4, created_at: '' } },
    { eid: O, name: 'doc', comp: { title: 'Open board task', body: '' } },
    { eid: O, name: 'task', comp: { status: 'open', priority: 1 } },
  ],
  deps: [],
}

// A comment on sub-1's claimed task, from another session, never notified —
// the thing the bus is supposed to hand over.
let C = 'bbbbbbbb-0000-4000-8000-000000000005'
let W = 'bbbbbbbb-0000-4000-8000-000000000006'
let busGraph: Snapshot = {
  changes: [
    ...graph.changes,
    { eid: W, name: 'entity', comp: { eid: W, num: 5, created_at: '' } },
    { eid: W, name: 'session', comp: { id: 'writer-1' } },
    { eid: C, name: 'entity', comp: { eid: C, num: 6, created_at: '' } },
    { eid: C, name: 'doc', comp: { title: '', body: 'the ask you missed' } },
    { eid: C, name: 'comment', comp: { target_eid: T } },
    {
      eid: C,
      name: 'created',
      comp: { eid: C, at: '2026-07-28T00:00:00.000Z', via: W },
    },
  ],
  deps: [],
}

// Serves busGraph and records the acks it is asked to write.
let busServer = () => {
  let acked: string[] = []
  let server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, async (req) => {
    let url = new URL(req.url)
    if (req.method == 'POST' && url.pathname == '/apply') {
      let changes = await req.json() as { eid: string; name: string }[]
      for (let c of changes) if (c.name == 'notified') acked.push(c.eid)
      return Response.json({ ok: true, changes })
    }
    if (url.pathname == '/snapshot') return Response.json(busGraph)
    return Response.json(
      rows(busGraph).map((r) => ({
        eid: r.eid,
        kind: r.kind,
        comps: r.comps,
      })),
    )
  })
  let port = (server.addr as Deno.NetAddr).port
  return { server, acked, host: `127.0.0.1:${port}` }
}

let graphServer = () => {
  let seen: string[] = []
  let all = rows(graph)
  let wire = (r: Row) => ({ eid: r.eid, kind: r.kind, comps: r.comps })
  let server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, (req) => {
    let url = new URL(req.url)
    let line = decodeURIComponent(`${url.pathname}${url.search}`)
    seen.push(line)
    if (url.pathname == '/snapshot') return Response.json(graph)
    let sid = line.match(/\.session\.id=([^&]+)/)?.[1]
    if (sid) {
      return Response.json(
        all.filter((r) => String(r.comps.session?.id) == sid).map(wire),
      )
    }
    let holder = line.match(/\.claim\.session_eid=([^&]+)/)?.[1]
    return Response.json(
      holder
        ? all.filter((r) => r.comps.claim?.session_eid == holder).map(wire)
        : all.map(wire),
    )
  })
  let port = (server.addr as Deno.NetAddr).port
  return { server, seen, host: `127.0.0.1:${port}` }
}

Deno.test('subagentDigest: a held claim renders that task block, nothing else', () => {
  let out = subagentDigest(sub, 'sub-1', 'general')
  assertEquals(out, '- T-2 wip — Child work')
  // never the operator digest's tiers
  for (
    let mark of ['## mail', '## lately', 'from the fleet', '## previously']
  ) {
    assertEquals(out.includes(mark), false)
  }
})

Deno.test('subagentDigest: TASKS_TASK names the block when set', () => {
  Deno.env.set('TASKS_TASK', 'T-2')
  try {
    // even a session holding no claim shows the managed task
    assertEquals(
      subagentDigest(sub, 'nobody', 'general'),
      '- T-2 wip — Child work',
    )
  } finally {
    Deno.env.delete('TASKS_TASK')
  }
})

Deno.test('subagentDigest: no task = a one-line identity note', () => {
  Deno.env.delete('TASKS_TASK')
  assertEquals(
    subagentDigest(sub, 'nobody', 'general'),
    '# subagent general · nobody',
  )
  assertMatch(subagentDigest(sub, 'nobody'), /^# subagent · nobody$/)
})

Deno.test('claimedDigest: only this session lease, never the open board', () => {
  let mine = rows(sub).filter((r) => r.comps.claim)
  assertEquals(claimedDigest(mine), '- T-2 wip — Child work')
  assertEquals(claimedDigest([]), '')
})

Deno.test('bare task prints usage without a session or server read', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await bareCli({ TASKS_HOST: host })
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), /^task — the entity graph/)
    assertEquals(seen, [])
  } finally {
    await server.shutdown()
  }
})

Deno.test('bare task appends the current claimed task digest', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await bareCli({ TASKS_HOST: host, TASKS_SESSION: 'sub-1' })
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), /task —[\s\S]*- T-2 wip — Child work/)
    assertEquals(seen, [
      '/query?kind=session&.session.id=sub-1',
      `/query?kind=task&.claim.session_eid=${S}`,
    ])
  } finally {
    await server.shutdown()
  }
})

Deno.test('bare task never reads or prints the open board', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await bareCli({ TASKS_HOST: host, TASKS_SESSION: 'idle-1' })
    assertEquals(out.code, 0)
    assertEquals(text(out.stdout).includes('Open board task'), false)
    assertEquals(seen.includes('/snapshot'), false)
  } finally {
    await server.shutdown()
  }
})

// Passive delivery: a verb that merely READ the graph serves the bus from
// what it already has — no per-verb wiring, and no second snapshot (one is
// ~16MB on a real graph). It rides stderr so a pipe or --json can never
// swallow a message that was just stamped read.
Deno.test('any graph-reading verb serves the bus, on stderr', async () => {
  let { server, acked, host } = busServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'show',
        'T-2',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
    }).output()
    assertEquals(out.code, 0)
    // the message reached the operator as a served notice...
    assertMatch(text(out.stderr), /pending messages/)
    assertMatch(text(out.stderr), /the ask you missed/)
    // ...and the block never touched what the caller asked for. (`show`
    // renders the comment thread itself on stdout, which is its job — what
    // must not leak there is the BUS, since that is what a pipe would eat.)
    assertEquals(/pending messages/.test(text(out.stdout)), false)
    // ...and was stamped read exactly once
    assertEquals(acked, [C])
  } finally {
    await server.shutdown()
  }
})
