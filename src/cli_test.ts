// The `task new` stray-flag guard: agents pattern-match to --flags, but the
// CLI grammar is dot-params. The guard must catch both the glued `--project=P`
// and the space-separated `--project P` forms — the latter is what agents
// actually type, and the bug that let it through polluted the owner board.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import {
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
  hookSession,
  hookTurn,
  jsonText,
  leadPrio,
  lifecycleHooks,
  listArgs,
  listing,
  liveRoleSessions,
  operatorHook,
  place,
  printer,
  releaseChange,
  reportUsage,
  restartReady,
  roleEid,
  showing,
  strayFile,
  strayFlag,
  subagentDigest,
  subject,
  subjectUsage,
  verbs,
} from './cli.ts'
import { rows } from './client.ts'
import { manuals, parse } from './manual.ts'
import { parseQuery } from './query.ts'
import { answers, fakeGraph } from './graph_fake.ts'
import type { Change, Snapshot } from './types.ts'
import { slow } from './testing.ts'
import { VERSION } from './version.ts'
import { sha } from './sha.ts'

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
    // A dead host on purpose; fail on the first refusal instead of retrying
    // through the 6.3s restart ladder these offline-parsing tests never need.
    env: { TASKS_HOST: '127.0.0.1:1', TASKS_BACKOFF: '' },
  }).output()

let bareCli = (env: Record<string, string>) =>
  new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', new URL('./cli.ts', import.meta.url).pathname],
    clearEnv: true,
    env,
  }).output()

let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

let commentBody = (args: string[], io: Parameters<typeof parse>[3]) =>
  parse('comment', manuals.comment, ['T-1', ...args], io).body

let unsafe = (text: string) =>
  [...text].filter((c) => {
    let n = c.charCodeAt(0)
    return (n < 0x20 && ![1, 2, 10].includes(n)) ||
      (n >= 0x7f && n <= 0x9f)
  })

slow('task --version succeeds without a server', async () => {
  let out = await cli('--version')
  assertEquals(out.code, 0)
  assertEquals(text(out.stdout), `task ${VERSION}\n`)
  assertEquals(text(out.stderr), '')
})

Deno.test('every routed CLI declaration owns its handler', () => {
  let names = Object.keys(manuals).filter((name) =>
    !['subject', ':'].includes(name)
  )
  assertEquals(Object.keys(verbs), names)
  for (let [name, verb] of Object.entries(verbs)) {
    assertEquals(typeof verb.run, 'function', name)
  }
})

Deno.test('printer: content cannot speak to the terminal', () => {
  let cases: [string, string, string][] = [
    ['ESC and BEL go', 'a\x1b]52;c;QQ==\x07b', 'a]52;c;QQ==b'],
    ['C1 goes', 'a\x9b2Jb', 'a2Jb'],
    ['DEL goes', 'a\x7fb', 'ab'],
    ['C0 goes', 'a\x00\x05\r\x1fb', 'ab'],
    ['FTS marks stay', 'a \x01hit\x02 b', 'a \x01hit\x02 b'],
    ['newlines stay', 'a\nb', 'a\nb'],
    ['tabs become spaces', 'a\tb', 'a  b'],
  ]
  for (let [what, content, want] of cases) {
    let got = ''
    printer((line) => got = line)(content)
    assertEquals(got, want, what)
  }
})

Deno.test('printer: CLI styling wraps sanitized content', () => {
  let got = ''
  printer((line) => got = line)('safe\x1b[2Jtext', true)
  assertEquals(got, '\x1b[1msafe[2Jtext\x1b[0m')
})

Deno.test('release guards the holder it read', () => {
  let row = rows({
    changes: [
      { eid: 'task', name: 'entity', comp: { eid: 'task', num: 1 } },
      { eid: 'task', name: 'task', comp: { status: 'open' } },
      { eid: 'task', name: 'claim', comp: { session: 'session-eid' } },
    ],
  })[0]
  assertEquals(releaseChange(row), {
    eid: row.eid,
    name: 'claim',
    comp: null,
    was: { session: sha('session-eid') },
  })
  delete row.comps.claim
  assertEquals(releaseChange(row), undefined)
})

Deno.test('usage reports preserve argv and session attribution', async () => {
  let got: { input?: string; init?: RequestInit } = {}
  // me() reads CLAUDE_CODE_SESSION_ID before TASKS_SESSION and branches on
  // CLAUDE_CODE_CHILD_SESSION — a suite run from a delegated Claude fork
  // inherits both, so neutralize them or the attribution under test is the
  // runner's identity, not the one we set.
  let saved = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION'].map((
    k,
  ) => [k, Deno.env.get(k)] as const)
  for (let [k] of saved) Deno.env.delete(k)
  Deno.env.set('TASKS_SESSION', 'agent-thread')
  try {
    await reportUsage(
      ['help', 'missing'],
      'no such help topic',
      (input, init) => {
        got = { input: String(input), init }
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    )
  } finally {
    Deno.env.delete('TASKS_SESSION')
    for (let [k, v] of saved) if (v != null) Deno.env.set(k, v)
  }
  assertMatch(got.input!, /\/usage$/)
  assertEquals(JSON.parse(String(got.init?.body)), {
    args: ['help', 'missing'],
    error: 'no such help topic',
    session: 'agent-thread',
  })
})

Deno.test('jsonText: terminal bytes go while parsed values stay whole', () => {
  let value = { body: 'a\x00\x7f\x9fb' }
  let got = jsonText(value)
  assertEquals(unsafe(got), [])
  assertEquals(JSON.parse(got), value)
})

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
  assertEquals(route('T-3 show --format=json'), {
    cmd: 'show',
    args: ['T-3', '--format=json'],
  })
  assertEquals(route('T-3 --format json'), {
    cmd: 'show',
    args: ['T-3', '--format', 'json'],
  })
  assertEquals(route('T-3 --quarantined'), {
    cmd: 'show',
    args: ['T-3', '--quarantined'],
  })
  assertEquals(route('T-3 show --json --quarantined'), {
    cmd: 'show',
    args: ['T-3', '--json', '--quarantined'],
  })
  // --comments affirms the default (comments always render), never errors.
  assertEquals(route('T-3 --comments'), {
    cmd: 'show',
    args: ['T-3', '--comments'],
  })
  assertEquals(route('T-3 show --comments'), {
    cmd: 'show',
    args: ['T-3', '--comments'],
  })
  assertEquals(route('T-3 as markdown'), { cmd: 'show', args: ['T-3'] })
  assertEquals(route('T-3 as json'), {
    cmd: 'show',
    args: ['T-3', '--json'],
  })
  assertEquals(route('T-3 show as markdown'), {
    cmd: 'show',
    args: ['T-3'],
  })
  assertEquals(route('T-3 show as json'), {
    cmd: 'show',
    args: ['T-3', '--json'],
  })
  assertEquals(route('T-3 is wip'), {
    cmd: 'set',
    args: ['T-3', '.status=wip'],
  })
  assertEquals(route('T-3 edge'), {
    cmd: 'help',
    args: ['subject', 'T-3'],
  })
  for (
    let edge of [
      'requires',
      'contains',
      'reads',
      'about',
      'supervises',
      'delegates',
    ]
  ) {
    assertEquals(route(`T-3 ${edge} T-9 --gone`), {
      cmd: 'dep',
      args: ['T-3', edge, 'T-9', '--gone'],
    })
    assertEquals(route(`T-3 :${edge} T-9 --gone`), {
      cmd: 'dep',
      args: ['T-3', edge, 'T-9', '--gone'],
    })
    assertEquals(route(`T-3 ${edge} ${edge} T-9 --gone`), {
      cmd: 'dep',
      args: ['T-3', edge, 'T-9', '--gone'],
    })
  }
})

Deno.test('showing: explicit show accepts the format phrase', () => {
  assertEquals(showing('show', ['D-18466', 'as', 'json']), {
    cmd: 'show',
    args: ['D-18466', '--json'],
  })
  assertEquals(showing('show', ['D-18466', 'as', 'markdown']), {
    cmd: 'show',
    args: ['D-18466'],
  })
  assertThrows(
    () => showing('show', ['D-18466', 'as', 'yaml']),
    Error,
    'format is one of: markdown, json',
  )
})

// `task decided` scopes itself to where you stand, so `.project=P-30` has to
// mean STAND THERE — the task column alone would answer with that project's
// tasks and hide its memories. Only the plain `=` form names a place; a list
// or a `!=` is a predicate, and screens whatever the scope already chose.
Deno.test('place: one project is somewhere to stand, a predicate is not', () => {
  let named = (q: string) => place(parseQuery(q))?.value
  assertEquals(named('.project=P-30'), 'P-30')
  assertEquals(named('.project=P-30 .status=done'), 'P-30')
  assertEquals(named('.project=P-30'), 'P-30')
  assertEquals(named('.status=done'), undefined)
  assertEquals(named('.project!=P-30'), undefined)
  assertEquals(named('.project=P-30,P-19'), undefined)
  // `.project=` is "no project at all" — an absence, not an address.
  assertEquals(named('.project='), undefined)
})

Deno.test('listing: a plural kind is the list verb, the singular is a subject', () => {
  assertEquals(listing('projects', []), { cmd: 'list', args: ['projects'] })
  assertEquals(listing('memories', ['--json']), {
    cmd: 'list',
    args: ['memories', '--json'],
  })
  assertEquals(listing('people', []), { cmd: 'list', args: ['people'] })
  assertEquals(listing('persons', []), { cmd: 'list', args: ['persons'] })
  assertEquals(listing('project', []), undefined)
  assertEquals(listing('T-3', []), undefined)
  assertEquals(listing(undefined, []), undefined)
  // `docs` spells the plural of the `doc` kind but is also a registered verb,
  // so the verb wins — the plural listing must not shadow it.
  assertEquals(listing('docs', []), undefined)
})

Deno.test('listArgs: --kind enters the canonical filter grammar', () => {
  assertEquals(
    listArgs({ opts: { '--kind': 'comment' }, words: ['.created.at>=today'] }),
    ['.kind=comment', '.created.at>=today'],
  )
  assertEquals(listArgs({ opts: { '--kind': 'comments' }, words: [] }), [
    '.kind=comment',
  ])
  assertEquals(listArgs({ opts: {}, words: ['projects'] }), ['projects'])
})

Deno.test('archive is a root verb before subject-first routing', () => {
  assertEquals(subject('archive', ['K-20995']), undefined)
})

Deno.test('subject: old commands and explicit focused commands keep their door', () => {
  assertEquals(subject('show', ['T-3']), undefined)
  assertEquals(subject('recall', ['M-4455']), undefined)
  assertEquals(subject('dep', ['T-3', 'requires', 'T-9']), undefined)
  assertEquals(subject('require', ['T-3', 'T-9']), undefined)
  assertEquals(subject('query', ['.kind=persona']), undefined)
  assertEquals(subject('graph_query', ['.kind=comment']), undefined)
  assertEquals(subject('fix', ['T-3']), undefined)
  assertEquals(subject('T-3', [':done']), undefined)
})

Deno.test('subject: knock enters the existing focused-command door', () => {
  assertEquals(subject('T-3', ['knock', 'P-19', 'please', 'look']), {
    cmd: 'T-3',
    args: [':knock', 'P-19', 'please', 'look'],
  })
})

Deno.test('subject: malformed sentences teach the contextual grammar', () => {
  assertThrows(() => subject('T-3', ['requires']), Error, '<id> [--gone]')
  assertThrows(
    () => subject('T-3', ['requires', 'requires', 'requires', 'T-9']),
    Error,
    '<id> [--gone]',
  )
  assertThrows(
    () => subject('T-3', ['show', 'T-9']),
    Error,
    'task show <id>',
  )
  assertThrows(() => subject('T-3', ['is', 'blocked']), Error, 'status is one')
  assertThrows(() => subject('T-3', ['as', 'yaml']), Error, 'format is one')
  assertThrows(
    () => subject('T-3', ['frobnicate']),
    Error,
    'task T-3 --help',
  )
})

slow('task subject help is contextual and needs no server', async () => {
  let out = await cli('T-3', '--help')
  assertEquals(out.code, 0)
  let stdout = text(out.stdout)
  assertMatch(stdout, /task T-3 — subject-first verbs/)
  assertMatch(
    stdout,
    /requires\|contains\|reads\|about\|supervises\|delegates\|recalled\|supersedes\|worked <id> \[--gone\]/,
  )
  assertMatch(stdout, /task T-3 is open\|wip\|done\|cancelled/)
  assertMatch(stdout, /task T-3 knock \[to\] \[words…\]/)
  assertEquals(subjectUsage('T-3').trim(), stdout.trim())
})

slow('task subject edge teaches the concrete edge verbs', async () => {
  let out = await cli('T-3', 'edge')
  assertEquals(out.code, 0)
  assertEquals(text(out.stderr), '')
  assertEquals(text(out.stdout).trim(), subjectUsage('T-3').trim())
})

Deno.test('parse: only explicit stdin spellings read the pipe', () => {
  let cases: [string[], string[], string, number][] = [
    [['--body=-'], [], 'piped', 1],
    [['--body=@-'], [], 'piped', 1],
    [['--body=literal'], [], 'literal', 0],
    [[], ['word', 'body'], 'word body', 0],
  ]
  for (let [flags, words, want, reads] of cases) {
    let read = 0
    let got = commentBody([...words, ...flags], {
      terminal: () => false,
      read: () => (read++, ' piped\n'),
    })
    assertEquals({ flags, got, read }, { flags, got: want, read: reads })
  }
})

// @ is the door's convention, not the flag's — a lone trailing @file is
// read exactly as --body=@file is, so a letter can never go out carrying
// the path of the file it should have quoted (T-10461).
Deno.test('parse: a lone trailing @file is read, prose is not', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole letter\n')
  let tty = { terminal: () => true, read: () => '' }
  assertEquals(commentBody([`@${f}`], tty), 'the whole letter\n')
  // @@ escapes to a literal @, the same as every other door
  assertEquals(commentBody(['@@handle'], tty), '@handle')
  // more than one word is prose: an opening @handle is never a filename
  assertEquals(commentBody(['@handle', 'thanks!'], tty), '@handle thanks!')
  assertEquals(commentBody(['plain', 'words'], tty), 'plain words')
  // a QUOTED sentence is still one argv token — prose, not a reference
  assertEquals(commentBody(['@handle thanks!'], tty), '@handle thanks!')
  // a missing file is loud — the caller's own token names the door
  assertThrows(
    () => commentBody(['@/no/such/file'], tty),
    Error,
    '@/no/such/file: no such file',
  )
  Deno.removeSync(f)
})

Deno.test('parse: a lone trailing @- is the pipe, and refuses a TTY', () => {
  // said positionally, both spellings, exactly as the flag says them
  for (let t of ['@-', '-']) {
    let read = 0
    assertEquals(
      commentBody([t], {
        terminal: () => false,
        read: () => (read++, ' hi\n'),
      }),
      'hi',
    )
    assertEquals(read, 1)
    assertThrows(
      () => commentBody([t], { terminal: () => true, read: () => 'x' }),
      Error,
      `${t}: stdin is a TTY`,
    )
  }
})

Deno.test('parse: both stdin spellings refuse a TTY', () => {
  for (let b of ['-', '@-']) {
    let read = 0
    assertThrows(
      () =>
        commentBody([`--body=${b}`], {
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

// The doors whose trailing words are a TITLE have no positional body door at
// all, so the param is the only way to say one — and a title built by
// SUBTRACTION swallowed it whole: `task design "…" .body=@plan.md` stored the
// flag in the title, minted an empty body and printed its receipt (T-14187).
// Both spellings, because the dot form is what every other writing door
// speaks and is what the agent who just filed a task types here.
Deno.test('parse: a value never reaches the words, at either spelling', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole design\n')
  let tty = { terminal: () => true, read: () => '' }
  for (let said of [`--body=@${f}`, `.body=@${f}`]) {
    let got = parse('design', manuals.design, ['Some', 'title', said], tty)
    assertEquals({ said, title: got.args.title }, {
      said,
      title: 'Some title',
    })
    assertEquals(got.body, 'the whole design\n')
  }
  // Prose keeps every word: only a param spelling is taken out of the text.
  let prose = parse('design', manuals.design, ['a', '.gitignore', 'rule'], tty)
  assertEquals(prose.many.title, ['a', '.gitignore', 'rule'])
  assertEquals(prose.body, undefined)
  // The token as TYPED names the door in an error, whichever spelling it was.
  for (let said of ['--body=@/no/such/file', '.body=@/no/such/file']) {
    assertThrows(
      () => parse('design', manuals.design, ['title', said], tty),
      Error,
      said,
    )
  }
  Deno.removeSync(f)
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
        message: { model: 'claude-opus-4-8' },
      }),
    )
    assertEquals(
      hookDialect({
        model: 'claude-opus-4-8',
        transcript_path: path,
      }, 'claude'),
      {
        provider: 'claude',
        model: 'claude-opus-4-8',
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

slow('task codex is discoverable with its own help', async () => {
  let out = await cli('codex', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /task codex \[codex args…\] \[--operator\][\s\S]*graph participant[\s\S]*task codex --operator resume --last/,
  )
})

slow('task comment help teaches verdict-bearing comments', async () => {
  let out = await cli('comment', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /--verdict=VERDICT[\s\S]*one of approved, rejected, changes_requested/,
  )
})

Deno.test('task claude scopes operator capability and strips its local flag', () => {
  let launch = claudeLaunch(
    ['--model', 'claude-opus-4-8', '--operator', '--continue'],
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
      'claude-opus-4-8',
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
    codexLaunch(['--operator', 'resume', '--last'], 42, '/repo'),
    {
      args: [
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
        ...codexHookArgs(),
        '-c',
        'model_instructions_file="/repo/.claude/agents/operator.md"',
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
  let ordinary = codexLaunch(['resume', '--last'], 42, '/repo')
  assertEquals(ordinary.env.TASKS_OPERATOR, '')
  assertEquals(ordinary.args.some((arg) => arg.includes('instructions')), false)
  let literal = codexLaunch(['--', '--operator'], 42, '/repo')
  assertEquals(literal.args.slice(-2), ['--', '--operator'])
  assertEquals(literal.args.some((arg) => arg.includes('instructions')), false)
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

Deno.test('SessionStart refuses collisions and rotates explicit handoffs', () => {
  let incumbent = 'bbbbbbbb-0000-4000-8000-000000000071'
  let resumed = 'bbbbbbbb-0000-4000-8000-000000000072'
  let sess = (
    eid: string,
    num: number,
    id: string,
    pid: number,
    at: string,
  ): Snapshot['changes'] => [
    { eid, name: 'entity', comp: { eid, num, created_at: '' } },
    { eid, name: 'session', comp: { id, pid, source: 'startup', operator: 1 } },
    { eid, name: 'created', comp: { at } },
  ]
  let all = rows({
    changes: [
      ...sess(resumed, 71, 'old-sid', 1111, '2026-08-06T12:00:00Z'),
      ...sess(incumbent, 72, 'live-sid', 4242, '2026-08-06T12:05:00Z'),
    ],
  })
  let start = { source: 'startup', operator: true }
  assertEquals(
    hookSession(all, 'phantom-sid', '/repo', 4242, start, 1),
    undefined,
  )
  assertEquals(
    hookSession(
      all,
      'reused-pid',
      '/repo',
      4242,
      start,
      Date.parse('2026-08-06T13:00:00Z'),
    )?.changes[0].comp?.id,
    'reused-pid',
  )

  let resume = hookSession(
    all,
    'old-sid',
    '/repo',
    4242,
    { source: 'resume', operator: true },
    1,
  )!
  assertEquals(resume.eid, resumed)
  assertEquals(resume.changes, [
    { eid: incumbent, name: 'session', comp: { pid: null } },
    {
      eid: resumed,
      name: 'session',
      comp: { cwd: '/repo', pid: 4242, source: 'resume' },
    },
    { eid: resumed, name: 'worktree', comp: { cwd: '/repo' } },
    { eid: resumed, name: 'runtime', comp: { pid: 4242 } },
  ])

  let clear = hookSession(
    all,
    'clear-sid',
    '/repo',
    4242,
    { source: 'clear', operator: true },
    1,
  )!
  assertEquals(clear.changes, [
    { eid: incumbent, name: 'session', comp: { pid: null } },
    {
      eid: clear.eid,
      name: 'session',
      comp: {
        id: 'clear-sid',
        cwd: '/repo',
        pid: 4242,
        source: 'clear',
        operator: 1,
      },
    },
    { eid: clear.eid, name: 'worktree', comp: { cwd: '/repo' } },
    { eid: clear.eid, name: 'runtime', comp: { pid: 4242 } },
  ])
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

// The drain decision `role cycle` waits on: a fresh spawn is refused while any
// wire-live session for the role exists (the adopt guard), so only genuinely
// live rows may hold the cycle. Active status OR an unwatched process is live;
// a completed row, and one whose process the server has watched shut, are not.
Deno.test('liveRoleSessions: only wire-live sessions gate a cycle restart', () => {
  let role = 'cccccccc-0000-4000-8000-000000000001'
  let sess = (
    eid: string,
    num: number,
    session: Record<string, unknown>,
  ): Snapshot['changes'] => [
    { eid, name: 'entity', comp: { eid, num, created_at: '' } },
    { eid, name: 'session', comp: { role, ...session } },
  ]
  let e = (n: number) => `cccccccc-0000-4000-8000-00000000010${n}`
  let all = rows({
    changes: [
      ...sess(e(1), 1, { id: 's1', status: 'running' }),
      ...sess(e(2), 2, { id: 's2', status: 'completed' }),
      ...sess(e(3), 3, { id: 's3', status: 'completed', pid: 999 }),
      ...sess(e(4), 4, {
        id: 's4',
        status: 'completed',
        pid: 999,
        finished_at: '2026-08-17T00:00:00Z',
      }),
      ...sess(e(5), 5, { id: 's5', status: 'stopping' }),
    ],
  })
  assertEquals(
    liveRoleSessions(all).map((r) => r.comps.session!.id).sort(),
    ['s1', 's3', 's5'],
  )
})

// `role cycle` restarts only once the stop is FULLY reconciled: the live session
// gone AND the reconciler's applied_hash cleared. A cleared hash with a session
// still alive, or a dead session while the hash still matches (the race cycle
// exists to close), must both hold the restart back.
Deno.test('restartReady: cleared applied_hash AND no live session', () => {
  let role = (applied_hash: string | null) =>
    rows({
      changes: [
        {
          eid: 'r',
          name: 'entity',
          comp: { eid: 'r', num: 9, created_at: '' },
        },
        { eid: 'r', name: 'role', comp: { state: 'stopped', applied_hash } },
      ],
    })[0]
  let sess = (status: string) =>
    rows({
      changes: [
        {
          eid: 's',
          name: 'entity',
          comp: { eid: 's', num: 8, created_at: '' },
        },
        { eid: 's', name: 'session', comp: { role: 'r', id: 's1', status } },
      ],
    })
  let dead = sess('interrupted')
  let live = sess('running')
  assertEquals(restartReady(role(null), dead), true) // settled: go
  assertEquals(restartReady(role('abc'), dead), false) // hash still matches: wait
  assertEquals(restartReady(role(null), live), false) // session still up: wait
  assertEquals(restartReady(role(null), []), true) // never spawned: go
  assertEquals(restartReady(undefined, dead), false) // role vanished: wait
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

// The launcher is the global `operate` CLI; its dry run prints the exact argv it
// would exec, so the --operator opt-in is checked against the real thing.
slow('the canonical operator launcher opts into work injection', async () => {
  let repo = await Deno.makeTempDir()
  try {
    await Deno.mkdir(`${repo}/.claude/agents`, { recursive: true })
    await Deno.writeTextFile(`${repo}/.claude/agents/operator.md`, 'persona')
    let out = await new Deno.Command('operate', {
      args: ['run'],
      cwd: repo,
      env: { DRY_RUN: '1' },
    }).output()
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), /^task claude --operator /)
  } finally {
    await Deno.remove(repo, { recursive: true })
  }
})

slow('task wrap help documents the legacy alias', async () => {
  let out = await cli('wrap', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /task wrap \[sid\] \[--hook\][\s\S]*task session wrap/,
  )
})

slow('deprecated routes leave root help but teach at their door', async () => {
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

slow('task require is a supported alias with focused help', async () => {
  let root = await cli('--help')
  assertEquals(root.code, 0)
  assertEquals(/^\s+task require\b/m.test(text(root.stdout)), false)

  let direct = await cli('require', '--help')
  assertEquals(direct.code, 0)
  assertMatch(
    text(direct.stdout),
    /task require <parent> <child> \[--gone\][\s\S]*task require T-3 T-9/,
  )
})

// A deprecated spelling HARD-ERRORS — it points at its replacement and
// refuses to run, so print-and-continue can't hide a partial run (T-16375).
// The gate follows the spelling typed, not the handler reached: the
// subject-first sentence IS the successor `dep` points at, so it runs on
// (and, against an empty graph, dies on `no entity`).
slow('a deprecated spelling hard-errors before its handler runs', async () => {
  // /query answers with a JSON ARRAY (a narrowed verb resolves its id
  // there first); everything else gets the empty-snapshot shape.
  let empty = Deno.serve(
    { port: 0, onListen: () => {} },
    (req) =>
      new URL(req.url).pathname == '/query'
        ? Response.json([])
        : Response.json({ changes: [], deps: [] }),
  )
  let run = (...args: string[]) =>
    new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        ...args,
      ],
      env: { TASKS_HOST: `127.0.0.1:${empty.addr.port}` },
    }).output()
  try {
    // The deprecated verb exits non-zero with the notice and never reaches
    // its handler — no `no entity` from a lookup it must not attempt.
    let typed = await run('dep', 'T-3', 'requires', 'T-9')
    assertEquals(typed.code, 1)
    assertMatch(text(typed.stderr), /task dep: deprecated — superseded by/)
    assertEquals(/no entity/.test(text(typed.stderr)), false)

    // The successor sentence runs its handler and dies on the empty graph.
    let sentence = await run('T-3', 'requires', 'T-9')
    assertMatch(text(sentence.stderr), /no entity: T-3/)
    assertEquals(/deprecated/.test(text(sentence.stderr)), false)

    // Carrying the focused-command colon into the sentence is the same edge
    // operation, not a lookup for a palette command named `requires`.
    let focused = await run('T-3', ':requires', 'T-9')
    assertMatch(text(focused.stderr), /no entity: T-3/)
    assertEquals(/not a command/.test(text(focused.stderr)), false)
  } finally {
    await empty.shutdown()
  }
})

slow('the --blocked-by refusal names the current edge door', async () => {
  let out = await cli('new', 'Title', '--blocked-by=T-1')
  assertEquals(out.code, 1)
  assertMatch(text(out.stderr), /an EDGE, not a prop/)
  assertMatch(text(out.stderr), /task <parent> requires <child>/)
  assertEquals(/task dep\b/.test(text(out.stderr)), false)
})

// Both grammars carry one mistake — the dot-param spelling used to earn
// the filter sketch, correct and silent about the edge it was reaching for.
slow('.blocked-by names the same edge door as --blocked-by', async () => {
  let out = await cli('new', 'Title', '.blocked-by=T-1')
  assertEquals(out.code, 1)
  assertMatch(text(out.stderr), /an EDGE, not a prop/)
  assertMatch(text(out.stderr), /task <parent> requires <child>/)
  assertEquals(/filters are dot-params/.test(text(out.stderr)), false)
})

slow('task session wrap help never runs the hook verb', async () => {
  let out = await cli('session', 'wrap', '--help')
  assertEquals(out.code, 0)
  assertMatch(text(out.stdout), /task session wrap \[sid\] \[--hook\]/)
})

slow('nested and palette help always resolves before effects', async () => {
  let cases: [string[], RegExp][] = [
    [['mail', 'show', '--help'], /^task mail show/],
    [['inbox', 'archive', '--help'], /^task inbox archive/],
    [['archive', '--help'], /^task archive/],
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

slow('task wrap rejects body before touching the session', async () => {
  let out = await cli('wrap', 'test-session', '--body=@brief.md')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /wrap takes no --body.+task session brief --body=…/,
  )
})

slow('task verbs reject unknown flags before their effects', async () => {
  let out = await cli('release', 'T-1', '--wat')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /release does not take --wat/,
  )
})

slow(
  'task verbs reject surplus words and missing values before effects',
  async () => {
    let cases: [string[], RegExp][] = [
      [['claim', 'T-1', 'sess', 'extra'], /claim expected 1–2 arguments/],
      [['inbox', 'archive', 'E-1', 'extra'], /expected 1 argument, got 2/],
      // The inbox takes filters now, so a bare word is no longer surplus —
      // it is a bad FILTER, and it teaches the verb instead of guessing
      // (T-10767). Refused before the snapshot, like every arity check.
      [['inbox', 'notafilter'], /not an inbox filter/],
      [['backup', 'extra'], /backup expected 0 arguments/],
      [['history', 'T-1', '-n'], /-n needs a positive number/],
    ]
    for (let [args, expected] of cases) {
      let out = await cli(...args)
      assertEquals(out.code, 1)
      assertEquals(text(out.stdout), '')
      assertMatch(text(out.stderr), expected)
    }
  },
)

slow('task set rejects surplus positional arguments', async () => {
  let out = await cli('set', 'T-1', '.status=open', 'surplus')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /task set <id> \[--body=BODY\] \[--comment=TEXT\]/,
  )
})

slow('task set --body patches the document body', async () => {
  let fake = graphServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'set',
        'T-2',
        '--body=revised brief',
      ],
      clearEnv: true,
      env: { TASKS_HOST: fake.host },
    }).output()
    assertEquals(out.code, 0, text(out.stderr))
    assertEquals(fake.acked, [
      { eid: T, name: 'doc', comp: { body: 'revised brief' } },
    ])
  } finally {
    await fake.server.shutdown()
  }
})

slow('task dep rejects surplus positional arguments', async () => {
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
    /task-turn/,
  )
  assertMatch(
    codex.Stop[0].hooks[0].command,
    /task-turn/,
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
    /TASKS_PROVIDER=claude task-turn/,
  )
  assertMatch(claude.Stop[0].hooks[0].command, /task-turn/)
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

// The @-token sibling. `task new "title" @body.md` is the corruption:
// the words ARE the title, so the path lands in it and the body mints
// empty. Every case is a whole argv WORD, the way a shell hands them over.
Deno.test('strayFile: an @file among the title words', () => {
  // README.md exists relative to the repo root the suite runs from — the
  // positive control, without which every case below passes vacuously.
  assertEquals(Deno.statSync('README.md').isFile, true)

  let cases: [string[], string | undefined][] = [
    [['a', 'title', '@README.md'], '@README.md'],
    [['@README.md'], '@README.md'],
    // nothing to read: prose, an escape, and a path that isn't there
    [['a', 'clean', 'title'], undefined],
    [['a', 'title', '@@README.md'], undefined],
    [['a', 'title', '@nope/not/here.md'], undefined],
    // one token holding whitespace is prose someone quoted, not a door
    [['@README.md and more'], undefined],
    // a bare word that happens to name a file is still just a word
    [['README.md'], undefined],
    [['@'], undefined],
  ]
  for (let [words, want] of cases) {
    assertEquals(strayFile(words), want, words.join(' '))
  }
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
    { eid: T, name: 'claim', comp: { session: S } },
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
    {
      eid: C,
      name: 'doc',
      comp: {
        title: '',
        body: 'the ask you missed\x1b]52;c;QQ==\x07\x9b2J\x7f',
      },
    },
    { eid: C, name: 'comment', comp: { target: T } },
    {
      eid: C,
      name: 'created',
      comp: { eid: C, at: '2026-07-28T00:00:00.000Z', via: W },
    },
  ],
  deps: [],
}

// Serves busGraph and records the acks it is asked to write.
let busServer = () => fakeGraph(busGraph)

let graphServer = (snap = graph) => fakeGraph(snap)

slow('task archive writes the inbox archived facet', async () => {
  let K = 'bbbbbbbb-0000-4000-8000-000000020995'
  let snap: Snapshot = {
    changes: [
      { eid: K, name: 'entity', comp: { eid: K, num: 20995 } },
      { eid: K, name: 'knock', comp: { target: T } },
    ],
    deps: [],
  }
  let { server, acked, host } = graphServer(snap)
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'archive',
        'K-20995',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host, TASKS_BACKOFF: '' },
    }).output()
    assertEquals(out.code, 0, text(out.stderr))
    assertEquals(text(out.stdout), 'archived K-20995\n')
    assertEquals(acked, [{ eid: K, name: 'archived', comp: {} }])
  } finally {
    await server.shutdown()
  }
})

Deno.test('the CLI has no whole-graph read path', () => {
  let source = Deno.readTextFileSync(new URL('./cli.ts', import.meta.url))
  assertEquals(source.includes('await snapshot()'), false)
})

slow('task require writes the subject-first requires edge', async () => {
  let fake = graphServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'require',
        'T-2',
        'T-4',
      ],
      env: { TASKS_HOST: fake.host },
    }).output()
    assertEquals(out.code, 0)
    assertEquals(text(out.stdout).trim(), 'T-2 requires T-4')
    assertEquals(fake.acked, [{
      eid: T,
      name: 'dependency',
      comp: { type: 'requires', child: O },
    }])
  } finally {
    await fake.server.shutdown()
  }
})

slow('inbox asks only for its reader and keeps order when read', async () => {
  let actor = 'bbbbbbbb-0000-4000-8000-000000000051'
  let far = 'bbbbbbbb-0000-4000-8000-000000000052'
  let watched = 'bbbbbbbb-0000-4000-8000-000000000053'
  let muted = 'bbbbbbbb-0000-4000-8000-000000000054'
  let direct = 'bbbbbbbb-0000-4000-8000-000000000055'
  let archived = 'bbbbbbbb-0000-4000-8000-000000000056'
  let watch = 'bbbbbbbb-0000-4000-8000-000000000057'
  let mute = 'bbbbbbbb-0000-4000-8000-000000000058'
  let item = (
    eid: string,
    num: number,
    target: string,
    body: string,
  ): Snapshot['changes'] => [
    { eid, name: 'entity', comp: { eid, num, created_at: '' } },
    { eid, name: 'doc', comp: { title: '', body } },
    { eid, name: 'comment', comp: { target: target } },
  ]
  let snap: Snapshot = {
    changes: [
      ...sub.changes,
      { eid: S, name: 'session', comp: { id: 'sub-1', actor: actor } },
      { eid: actor, name: 'entity', comp: { eid: actor, num: 51 } },
      { eid: far, name: 'entity', comp: { eid: far, num: 52 } },
      ...item(watched, 53, far, 'watched words'),
      ...item(muted, 54, T, 'muted words'),
      ...item(direct, 55, S, 'direct words'),
      ...item(archived, 56, S, 'archived words'),
      {
        eid: direct,
        name: 'created',
        comp: { at: '2026-08-07T12:00:00.000Z' },
      },
      {
        eid: watched,
        name: 'created',
        comp: { at: '2026-08-07T13:00:00.000Z' },
      },
      { eid: watched, name: 'opened', comp: {} },
      { eid: archived, name: 'archived', comp: { at: 'now' } },
      { eid: watch, name: 'entity', comp: { eid: watch, num: 57 } },
      {
        eid: watch,
        name: 'subscription',
        comp: { actor: actor, target: far, mode: 'watch' },
      },
      { eid: mute, name: 'entity', comp: { eid: mute, num: 58 } },
      {
        eid: mute,
        name: 'subscription',
        comp: { actor: actor, target: T, mode: 'mute' },
      },
    ],
    deps: [],
  }
  let { server, seen, host } = graphServer(snap)
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'inbox',
        '--json',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
    }).output()
    assertEquals(out.code, 0, text(out.stderr))
    let got = JSON.parse(text(out.stdout)) as { doc: { body: string } }[]
    assertEquals(got.map((r) => r.doc.body), ['direct words', 'watched words'])
    assertEquals(seen.some((path) => path.startsWith('/snapshot')), false)
  } finally {
    await server.shutdown()
  }
})

slow('list strips terminal controls from graph text', async () => {
  let poisoned: Snapshot = {
    ...graph,
    changes: graph.changes.map((change) =>
      change.eid == O && change.name == 'doc'
        ? {
          ...change,
          comp: {
            title: 'Open\x1b]52;c;QQ==\x07 board\x9b2J\x7f\x00 task',
            body: '',
          },
        }
        : change
    ),
  }
  let { server, host } = graphServer(poisoned)
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'list',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host },
    }).output()
    let stdout = text(out.stdout)
    assertEquals(out.code, 0)
    assertMatch(stdout, /Open]52;c;QQ== board2J task/)
    assertEquals(unsafe(stdout), [])
  } finally {
    await server.shutdown()
  }
})

slow('list shows the wake title derived by the UI', async () => {
  let wake = 'bbbbbbbb-0000-4000-8000-000000000061'
  let recipient = 'bbbbbbbb-0000-4000-8000-000000000062'
  let at = new Date(Date.now() + 7_200_000).toISOString()
  let snap: Snapshot = {
    changes: [
      { eid: wake, name: 'entity', comp: { eid: wake, num: 61 } },
      { eid: wake, name: 'wake', comp: { at } },
      { eid: wake, name: 'deliver', comp: { to: recipient } },
      { eid: recipient, name: 'entity', comp: { eid: recipient, num: 62 } },
      { eid: recipient, name: 'project', comp: {} },
    ],
    deps: [],
  }
  let { server, seen, host } = graphServer(snap)
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'list',
        '.kind=wake',
        '.wake.at>=now',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host },
    }).output()
    assertEquals(out.code, 0, text(out.stderr))
    assertMatch(text(out.stdout), /^W-61\s+wake P-62 · in 2 hours$/m)
    assertEquals(seen.some((path) => path.startsWith('/snapshot')), false)
  } finally {
    await server.shutdown()
  }
})

slow('setting a wake shows every pending wake for that session', async () => {
  let session = 'bbbbbbbb-0000-4000-8000-000000000071'
  let target = 'bbbbbbbb-0000-4000-8000-000000000072'
  let existing = 'bbbbbbbb-0000-4000-8000-000000000073'
  let changes: Change[] = [
    { eid: session, name: 'entity', comp: { eid: session, num: 71 } },
    { eid: session, name: 'session', comp: { id: 'wake-reader' } },
    { eid: target, name: 'entity', comp: { eid: target, num: 72 } },
    { eid: target, name: 'task', comp: { status: 'open' } },
    { eid: existing, name: 'entity', comp: { eid: existing, num: null } },
    {
      eid: existing,
      name: 'wake',
      comp: {
        at: new Date(Date.now() + 7_200_000).toISOString(),
        target,
        note: 'existing reminder',
      },
    },
    { eid: existing, name: 'deliver', comp: { to: session } },
  ]
  let server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    let url = new URL(req.url)
    if (req.method == 'POST' && url.pathname == '/apply') {
      let sent = await req.json() as Change[]
      for (let eid of new Set(sent.map((c) => c.eid))) {
        if (!changes.some((c) => c.eid == eid)) {
          changes.push({ eid, name: 'entity', comp: { eid, num: null } })
        }
      }
      changes.push(...sent)
      return Response.json({ ok: true, changes: sent })
    }
    let snap = { changes, deps: [] }
    if (url.pathname == '/snapshot') return Response.json(snap)
    return Response.json(answers(snap)(decodeURIComponent(url.search.slice(1))))
  })
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'wake',
        'S-71',
        'in 3 hours',
        'T-72',
        '--body=new reminder',
      ],
      clearEnv: true,
      env: { TASKS_HOST: `127.0.0.1:${server.addr.port}` },
    }).output()
    let stdout = text(out.stdout)
    assertEquals(out.code, 0, text(out.stderr))
    assertMatch(stdout, /pending wakes for S-71 \(2\):/)
    assertMatch(stdout, /existing reminder/)
    assertMatch(stdout, /new reminder/)
  } finally {
    await server.shutdown()
  }
})

slow(
  'entity JSON has one component-shaped contract across CLI doors',
  async () => {
    let task = 'bbbbbbbb-0000-4000-8000-000000000041'
    let comment = 'bbbbbbbb-0000-4000-8000-000000000042'
    let snap: Snapshot = {
      changes: [
        { eid: task, name: 'entity', comp: { eid: task, num: 41 } },
        {
          eid: task,
          name: 'doc',
          comp: { eid: task, title: 'Structured', body: 'One shape' },
        },
        {
          eid: task,
          name: 'task',
          comp: { eid: task, status: 'done', priority: 2 },
        },
        {
          eid: task,
          name: 'decided',
          comp: { eid: task, at: '2026-08-03T00:00:00.000Z' },
        },
        { eid: comment, name: 'entity', comp: { eid: comment, num: 42 } },
        {
          eid: comment,
          name: 'doc',
          comp: { eid: comment, title: '', body: 'Looks right' },
        },
        {
          eid: comment,
          name: 'comment',
          comp: { eid: comment, target: task },
        },
      ],
      deps: [],
    }
    let { server, seen, host } = graphServer(snap)
    let run = (...args: string[]) =>
      new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          ...args,
        ],
        env: { TASKS_HOST: host },
      }).output()
    let entity = {
      kind: 'task',
      entity: { eid: task, num: 41 },
      doc: { title: 'Structured', body: 'One shape' },
      task: { status: 'done', priority: 2 },
      decided: { at: '2026-08-03T00:00:00.000Z' },
    }
    try {
      let listed = await run('list', '--limit', '1', '--json')
      let decided = await run('decided', '--all', '--json')
      let shown = await run('show', 'T-41', '--json')
      let formatted = await run('show', 'T-41', '--format=json')
      assertEquals(listed.code, 0)
      assertEquals(seen[0], '/query?limit=1&.kind=task')
      assertEquals(decided.code, 0)
      assertEquals(shown.code, 0)
      assertEquals(formatted.code, 0)
      assertEquals(JSON.parse(text(listed.stdout)), [entity])
      assertEquals(JSON.parse(text(decided.stdout)), [entity])
      assertEquals(text(formatted.stdout), text(shown.stdout))
      assertEquals(JSON.parse(text(shown.stdout)), {
        ...entity,
        refs: [],
        backrefs: [],
        comments: [{
          kind: 'comment',
          entity: { eid: comment, num: 42 },
          doc: { title: '', body: 'Looks right' },
          comment: { target: task },
        }],
      })
    } finally {
      await server.shutdown()
    }
  },
)

slow('colon open prints the public entity URL', async () => {
  let { server, host } = graphServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        ':open',
        'T-2',
      ],
      env: { TASKS_HOST: host },
    }).output()
    assertEquals(out.code, 0)
    assertEquals(text(out.stdout).trim(), 'https://tasks.yak.sh/T-2')
  } finally {
    await server.shutdown()
  }
})

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

slow('bare task prints usage without a session or server read', async () => {
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

slow('invalid help reports the exact CLI usage failure', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'help',
        'missing',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
    }).output()
    assertEquals(out.code, 1)
    assertMatch(text(out.stderr), /no such help topic: missing/)
    assertEquals(seen, ['/usage'])
  } finally {
    await server.shutdown()
  }
})

slow('bare task appends the current claimed task digest', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await bareCli({ TASKS_HOST: host, TASKS_SESSION: 'sub-1' })
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), /task —[\s\S]*- T-2 wip — Child work/)
    // The compact bare-command digest is not the explicit context door: it
    // resolves only the session and its claimed task, with no inbox sidecar.
    assertEquals(
      [...seen].sort(),
      [
        '/query?.kind=session&.session.id=sub-1',
        `/query?.kind=task&.claim.session=${S}`,
      ].sort(),
    )
  } finally {
    await server.shutdown()
  }
})

slow('bare task never reads or prints the open board', async () => {
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

// Model input has one explicit door. Ordinary verbs never append an implicit
// sidecar or mutate human inbox state.
slow('a verb that reads nothing does not serve agent input', async () => {
  let { server, acked, seen, host } = busServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'help',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
    }).output()
    assertEquals(out.code, 0)
    assertEquals(text(out.stderr), '')
    assertEquals(acked, [])
    assertEquals(seen, [])
  } finally {
    await server.shutdown()
  }
})

// A hook other than context has no model reader, so it serves nothing.
slow(
  'a hook never serves the bus, because nobody is there to read it',
  async () => {
    for (
      let args of [['wrap', '--hook'], ['session', 'turn', 'idle', '--hook']]
    ) {
      let { server, acked, host } = busServer()
      try {
        let out = await new Deno.Command(Deno.execPath(), {
          args: [
            'run',
            '-A',
            new URL('./cli.ts', import.meta.url).pathname,
            ...args,
          ],
          clearEnv: true,
          env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
          stdin: 'null',
        }).output()
        assertEquals(/pending messages/.test(text(out.stderr)), false)
        assertEquals(acked.filter((c) => c.name == 'notified'), [])
      } finally {
        await server.shutdown()
      }
    }
  },
)

// Context is the explicit model attention boundary. It serves current input on
// stdout without writing human read-state.
slow('the boot digest is the hook that delivers, on stdout', async () => {
  let { server, acked, seen, host } = busServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'session',
        'context',
        'sub-1',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host },
    }).output()
    assertEquals(out.code, 0, text(out.stderr))
    assertMatch(text(out.stdout), /pending messages/)
    assertMatch(text(out.stdout), /the ask you missed/)
    assertEquals(acked, [])
    assertEquals(seen.some((path) => path.startsWith('/snapshot')), false)
  } finally {
    await server.shutdown()
  }
})

slow('a graph-reading verb does not append agent input', async () => {
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
    assertEquals(text(out.stderr), '')
    assertEquals(unsafe(text(out.stderr)), [])
    assertEquals(/pending messages/.test(text(out.stdout)), false)
    assertEquals(unsafe(text(out.stdout)), [])
    assertEquals(acked, [])
  } finally {
    await server.shutdown()
  }
})

// T-14573: `task cancel T-4 …` used to resolve as the FOCUSED-task `:cancel`
// — the id read as reason prose, cancelling whatever S-1 had claimed (T-2
// here) and posting "T-4 …" as the reason. An id-shaped first word must
// name the TARGET, never ride along as text. `task done T-4` used to fail
// outright (`usage: task :done`, since :done takes zero words) rather than
// act on T-4 at all.
slow(
  'task done/cancel <id> act on the named task, never the focused one',
  async () => {
    let { server, acked, seen, host } = graphServer(graph)
    try {
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          'cancel',
          'T-4',
          'duplicate of the umbrella',
        ],
        clearEnv: true,
        env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' }, // sub-1 has T-2 claimed
      }).output()
      assertEquals(text(out.stderr), '')
      assertEquals(out.code, 0)
      assertMatch(
        text(out.stdout),
        /^T-4 → cancelled — duplicate of the umbrella/,
      )
      let task = acked.filter((c) => c.name == 'task')
      assertEquals(task, [{
        eid: O,
        name: 'task',
        comp: { status: 'cancelled' },
      }])
      let comment = acked.find((c) => c.name == 'comment')
      assertEquals(comment?.comp, { target: O })
      assertEquals(seen.some((path) => path.startsWith('/snapshot')), false)
    } finally {
      await server.shutdown()
    }
  },
)

slow(
  'task done <id> targets the id even with no comment, past its 0-word palette form',
  async () => {
    let { server, acked, host } = graphServer(graph)
    try {
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          'done',
          'T-4',
        ],
        clearEnv: true,
        env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
      }).output()
      assertEquals(text(out.stderr), '')
      assertEquals(out.code, 0)
      assertEquals(text(out.stdout).trim(), 'T-4 → done')
      assertEquals(
        acked.filter((c) => c.name == 'task'),
        [{ eid: O, name: 'task', comp: { status: 'done' } }],
      )
    } finally {
      await server.shutdown()
    }
  },
)

slow(
  'task wip <id> targets the named task past its 0-word palette form',
  async () => {
    let { server, acked, host } = graphServer(graph)
    try {
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          'wip',
          'T-4',
        ],
        clearEnv: true,
        env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
      }).output()
      assertEquals(text(out.stderr), '')
      assertEquals(out.code, 0)
      assertEquals(text(out.stdout).trim(), 'T-4 → wip')
      assertEquals(
        acked.filter((c) => c.name == 'task'),
        [{ eid: O, name: 'task', comp: { status: 'wip' } }],
      )
    } finally {
      await server.shutdown()
    }
  },
)

// The non-id spellings are untouched: `task cancel <prose>` with no
// id-shaped first word still means the FOCUSED task, exactly as `task
// :cancel <prose>` always has.
slow(
  'task cancel with no id-shaped word still targets the focused task',
  async () => {
    let { server, acked, host } = graphServer(graph)
    try {
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          'cancel',
          'duplicate',
          'of',
          'the',
          'umbrella',
        ],
        clearEnv: true,
        env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
      }).output()
      assertEquals(text(out.stderr), '')
      assertEquals(out.code, 0)
      assertMatch(
        text(out.stdout),
        /^T-2 → cancelled — duplicate of the umbrella/,
      )
      assertEquals(
        acked.filter((c) => c.name == 'task'),
        [{ eid: T, name: 'task', comp: { status: 'cancelled' } }],
      )
    } finally {
      await server.shutdown()
    }
  },
)

// An id-shaped word past the 0-word palette form used to be a bare, unhelpful
// `usage: task :done` — it still refuses (:done is still argument-less from
// the focus door), but only when the word does NOT name a task.
slow(
  'task done <non-id-word> keeps refusing loudly, not silently',
  async () => {
    let out = await cli('done', 'because')
    assertEquals(out.code, 1)
    assertMatch(text(out.stderr), /:done expected 0–0 arguments/)
  },
)

// The same guard through the positional and --body= doors, since the
// mistake transfers between verbs (T-10612).
Deno.test('parse: a lone path that forgot its @ is refused at every door', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole letter\n')
  let tty = { terminal: () => true, read: () => '' }
  assertThrows(() => commentBody([f], tty), Error, 'did you mean @')
  assertThrows(
    () => commentBody([`--body=${f}`], tty),
    Error,
    'did you mean @',
  )
  // Prose keeps its exemption: more than one token is never a reference.
  assertEquals(commentBody(['see', f, 'please'], tty), `see ${f} please`)
  // And one token holding whitespace is still prose, @ or not.
  assertEquals(commentBody([`@handle re ${f}`], tty), `@handle re ${f}`)
  Deno.removeSync(f)
})

// The mistake that actually shipped: the dot-param handed to `task comment`
// as its positional body. It reached the graph as prose and fanned out as
// mail, so the guard has to hold at the door the caller reached for.
Deno.test('parse: a body flag in the value position is refused at every door', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole ruling\n')
  let tty = { terminal: () => true, read: () => '' }
  assertThrows(() => commentBody([`body=@${f}`], tty), Error, 'Pass just')
  assertThrows(
    () => commentBody([`--body=.body=@${f}`], tty),
    Error,
    'Pass just',
  )
  // The corrected value reads the file through both doors — the control that
  // earns the suggestion its place.
  assertEquals(commentBody([`@${f}`], tty), 'the whole ruling\n')
  assertEquals(commentBody([`--body=@${f}`], tty), 'the whole ruling\n')
  // Prose keeps its exemption here too.
  assertEquals(commentBody(['body=@x or so'], tty), 'body=@x or so')
  Deno.removeSync(f)
})

// The WHOLE family in one table, because the family is only closed if every
// spelling is asserted — the dropped @ (T-10612), the flag in the value
// position (T-10858), and the dropped separator (T-10873). The last row is the
// positive control: the spelling that works must still work, or this test is
// measuring nothing.
Deno.test('parse: every misplaced-body spelling is refused, and @file still reads', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole ruling\n')
  let tty = { terminal: () => true, read: () => '' }
  for (let said of [`.body=@${f}`, `--body=@${f}`, `body=@${f}`]) {
    assertThrows(
      () => commentBody([`--`, said], tty),
      Error,
      'value position',
      said,
    )
  }
  for (let flag of ['.body', '--body', 'body']) {
    assertThrows(
      () => commentBody(['--', flag, `@${f}`], tty),
      Error,
      "space instead of '='",
      flag,
    )
  }
  assertThrows(
    () => commentBody([f], tty),
    Error,
    'names a file that exists',
  )
  assertEquals(commentBody([`@${f}`], tty), 'the whole ruling\n')
  Deno.removeSync(f)
})

// The CLI reader end to end: `task transcript` reads the graph ENTRY PARTITION
// through the query door and renders it — the /logs door is gone (T-16798), so
// this is the one thing that keeps the CLI reader honest after the cutover
// (T-16825 acceptance). It asks `.entry.session=`, never /logs, never the whole
// graph, and every entry kind (user say, exec, agent say) renders in seq order.
slow(
  'task transcript reads and renders the graph entry partition',
  async () => {
    let S = 'bbbbbbbb-0000-4000-8000-000000000071'
    let e1 = 'bbbbbbbb-0000-4000-8000-0000000000a1'
    let e2 = 'bbbbbbbb-0000-4000-8000-0000000000a2'
    let e3 = 'bbbbbbbb-0000-4000-8000-0000000000a3'
    let snap: Snapshot = {
      changes: [
        { eid: S, name: 'entity', comp: { eid: S, num: 71 } },
        {
          eid: S,
          name: 'session',
          comp: { id: 'sess-71', provider: 'codex', model: 'gpt-x' },
        },
        // seq 1 — the user's opening entry
        { eid: e1, name: 'entity', comp: { eid: e1, num: null } },
        { eid: e1, name: 'entry', comp: { session: S, seq: 1 } },
        { eid: e1, name: 'message', comp: { role: 'user' } },
        { eid: e1, name: 'content', comp: { body: 'USER_ASKS_XYZZY' } },
        // seq 2 — a tool call the agent ran
        { eid: e2, name: 'entity', comp: { eid: e2, num: null } },
        { eid: e2, name: 'entry', comp: { session: S, seq: 2 } },
        { eid: e2, name: 'call', comp: { key: 'k1' } },
        { eid: e2, name: 'bash', comp: { command: 'echo PLOVER' } },
        // seq 3 — the agent's answer
        { eid: e3, name: 'entity', comp: { eid: e3, num: null } },
        { eid: e3, name: 'entry', comp: { session: S, seq: 3 } },
        { eid: e3, name: 'message', comp: { role: 'agent' } },
        { eid: e3, name: 'content', comp: { body: 'AGENT_REPLIES_PLUGH' } },
      ],
      deps: [],
    }
    let { server, seen, host } = graphServer(snap)
    try {
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          'transcript',
          'S-71',
        ],
        clearEnv: true,
        env: { TASKS_HOST: host },
      }).output()
      assertEquals(out.code, 0, text(out.stderr))
      let stdout = text(out.stdout)
      // It reached the entry partition — never a /logs door, never a whole-graph read.
      assert(seen.some((path) => path.includes('.entry.session=')))
      assertEquals(seen.some((path) => path.includes('/logs')), false)
      assertEquals(seen.some((path) => path.startsWith('/snapshot')), false)
      // Every entry kind rendered, in seq order.
      assertMatch(stdout, /user: USER_ASKS_XYZZY/)
      assertMatch(stdout, /\$ echo PLOVER/)
      assertMatch(stdout, /agent: AGENT_REPLIES_PLUGH/)
      // The header names the session and its provider.
      assertStringIncludes(stdout, 'S-71')
      assertStringIncludes(stdout, 'codex')

      let peek = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          'session',
          'peek',
          'S-71',
          '--lines=1',
        ],
        clearEnv: true,
        env: { TASKS_HOST: host },
      }).output()
      assertEquals(peek.code, 0, text(peek.stderr))
      let glance = text(peek.stdout)
      assertEquals(glance.includes('USER_ASKS_XYZZY'), false)
      assertEquals(glance.includes('echo PLOVER'), false)
      assertStringIncludes(glance, 'AGENT_REPLIES_PLUGH')
    } finally {
      await server.shutdown()
    }
  },
)
