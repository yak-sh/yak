// The `task new` stray-flag guard: agents pattern-match to --flags, but the
// CLI grammar is dot-params. The guard must catch both the glued `--project=P`
// and the space-separated `--project P` forms — the latter is what agents
// actually type, and the bug that let it through polluted the owner board.
import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'
import {
  bodyOf,
  claimedDigest,
  claudeLaunch,
  codexArgs,
  finalText,
  hookDialect,
  leadPrio,
  operatorHook,
  strayFlag,
  subagentDigest,
  subject,
  subjectUsage,
  workHook,
} from './cli.ts'
import { observerDigest, type Row, rows } from './client.ts'
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

Deno.test('bodyOf: only explicit stdin spellings read the pipe', async () => {
  let cases: [string[], string[], string, number][] = [
    [['--body=-'], [], 'piped', 1],
    [['--body=@-'], [], 'piped', 1],
    [['--body=literal'], [], 'literal', 0],
    [[], ['word', 'body'], 'word body', 0],
  ]
  for (let [flags, words, want, reads] of cases) {
    let read = 0
    let got = await bodyOf(flags, words, {
      terminal: () => false,
      read: () => {
        read++
        return Promise.resolve(' piped\n')
      },
    })
    assertEquals({ flags, got, read }, { flags, got: want, read: reads })
  }
})

Deno.test('bodyOf: both stdin spellings refuse a TTY', async () => {
  for (let b of ['-', '@-']) {
    let read = 0
    await assertRejects(
      () =>
        bodyOf([`--body=${b}`], [], {
          terminal: () => true,
          read: () => {
            read++
            return Promise.resolve('piped')
          },
        }),
      Error,
      `--body=${b}: stdin is a TTY`,
    )
    assertEquals(read, 0)
  }
})

Deno.test('codexArgs: full access and lifecycle lead, caller args keep order', () => {
  assertEquals(codexArgs(['resume', '--last']), [
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    'resume',
    '--last',
  ])
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
    assertEquals(hookDialect({ transcript_path: path }), {
      provider: 'claude',
      model: 'claude-opus-5',
      transcript: path,
    })
    assertEquals(
      hookDialect({
        model: 'gpt-5.6-sol',
        transcript_path: '/unstable/codex.jsonl',
      }),
      {
        provider: 'codex',
        model: 'gpt-5.6-sol',
        transcript: '/unstable/codex.jsonl',
      },
    )
  } finally {
    Deno.removeSync(path)
  }
})

Deno.test('task codex is discoverable with its own help', async () => {
  let out = await cli('codex', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /task codex \[codex args\.\.\.\][\s\S]*task codex resume --last/,
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

  let observer = claudeLaunch(['--continue'], true, 42)
  assertEquals(observer.env, {
    TASKS_OPERATOR: '',
    TASKS_TASK: '',
    CLAUDE_CODE_CHILD_SESSION: '',
  })
  assertEquals(
    claudeLaunch(['--', '--operator'], true, 42).args.slice(-2),
    ['--', '--operator'],
  )
})

Deno.test('an unmarked Claude hook observes; explicit work paths may claim', () => {
  let env = (vars: Record<string, string>) => (name: string) => vars[name]
  let parent = (_pid: number) => 42
  assertEquals(workHook('claude', undefined, 7, env({}), parent), false)
  assertEquals(
    workHook('claude', undefined, 7, env({ TASKS_OPERATOR: '42' }), parent),
    true,
  )
  assertEquals(
    workHook('claude', undefined, 7, env({ TASKS_OPERATOR: '99' }), parent),
    false,
  )
  assertEquals(
    workHook('claude', undefined, 7, env({ TASKS_TASK: 'T-2' }), parent),
    false,
  )
  assertEquals(workHook('claude', { operator: true }, 7, env({}), parent), true)
  assertEquals(
    workHook('claude', { operator: false }, 7, env({}), parent),
    false,
  )
  assertEquals(
    workHook('claude', { origin: 'managed' }, 7, env({}), parent),
    true,
  )
  assertEquals(workHook('codex', undefined, 7, env({}), parent), true)
  assertEquals(operatorHook(7, env({ TASKS_OPERATOR: '42' }), parent), true)

  let out = observerDigest('probe-1')
  assertMatch(out, /observation-only target/)
  for (let mark of ['T-2', 'claim:', '## mail', 'from the fleet']) {
    assertEquals(out.includes(mark), false)
  }
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

Deno.test('task session wrap help never runs the hook verb', async () => {
  let out = await cli('session', 'wrap', '--help')
  assertEquals(out.code, 0)
  assertMatch(text(out.stdout), /task session wrap \[sid\] \[--hook\]/)
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

Deno.test('Codex hooks inject sessions, delegate children, and wrap at exit', () => {
  let path = new URL('../.codex/hooks.json', import.meta.url)
  let config = JSON.parse(Deno.readTextFileSync(path)) as {
    hooks: Record<string, { hooks: { command: string; timeout?: number }[] }[]>
  }
  assertEquals(Object.keys(config.hooks), [
    'SessionStart',
    'SubagentStart',
    'SessionEnd',
  ])
  assertMatch(
    config.hooks.SessionStart[0].hooks[0].command,
    /task session context --hook/,
  )
  assertMatch(
    config.hooks.SubagentStart[0].hooks[0].command,
    /task session context --hook/,
  )
  assertMatch(
    config.hooks.SessionEnd[0].hooks[0].command,
    /task session wrap --hook/,
  )
  assertEquals(config.hooks.SessionEnd[0].hooks[0].timeout, 3)
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

Deno.test('strayFlag: hyphenated flag name (--blocked-by)', () => {
  assertEquals(
    strayFlag(['Title', '--blocked-by', 'T-9']),
    { got: '--blocked-by', suggest: '.blocked-by=T-9' },
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
